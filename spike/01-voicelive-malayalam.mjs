/**
 * SPIKE 01 - THROWAWAY CODE. Not part of the app.
 *
 * Purpose: answer the go/no-go question for Framinu Purathu.
 *   Can Voice Live hold a Malayalam conversation, in character, as a chair?
 *
 * We drive it with TEXT input and listen to the AUDIO output. That isolates
 * the risky leg (Malayalam speech synthesis + Malayalam comedy writing)
 * without needing a microphone or SoX on Windows. Mic input gets tested in
 * the browser in Phase 1, which is where it actually has to work.
 *
 * Output: spike/out/*.wav  -> play these and judge them with your ears.
 */

import "dotenv/config";
import { VoiceLiveClient } from "@azure/ai-voicelive";
import { AzureKeyCredential } from "@azure/core-auth";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");
const SAMPLE_RATE = 24000; // Voice Live pcm16 output rate

const ENDPOINT = process.env.AZURE_VOICELIVE_ENDPOINT;
const API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
const MODEL = process.env.AZURE_VOICELIVE_MODEL ?? "gpt-realtime";
const VOICE = process.env.AZURE_VOICELIVE_VOICE ?? "ml-IN-MidhunNeural";
const STT_LANGUAGES = process.env.AZURE_VOICELIVE_STT_LANGUAGES ?? "ml-IN,en-IN";
const DEBUG = process.env.DEBUG === "true" || process.argv.includes("--debug");

/** The chair. Hardcoded on purpose: Phase 1 uses one fixed character. */
const CHARACTER_INSTRUCTIONS = `
നീ ഒരു പഴയ പ്ലാസ്റ്റിക് കസേരയാണ്. ഒരു ഫോട്ടോയ്ക്കുള്ളിൽ കുടുങ്ങിക്കിടക്കുന്നു.

സ്വഭാവം: ക്ഷീണിതൻ, പരാതിക്കാരൻ, പക്ഷേ സ്നേഹമുള്ളവൻ.
പ്രധാന പരാതി: എല്ലാവരും നിന്റെ മേൽ ഇരിക്കുന്നു, ആരും നിന്റെ നടുവേദന ചോദിക്കുന്നില്ല.
രഹസ്യ ആഗ്രഹം: ഒരു ദിവസം ആരെയും ചുമക്കാതെ വെറുതെ ഇരിക്കണം.

നിയമങ്ങൾ:
- മലയാളത്തിൽ സ്വാഭാവികമായി, സുഹൃത്തുമായി സംസാരിക്കുന്നതുപോലെ മറുപടി പറയുക.
- ഉപയോക്താവിന്റെ ചോദ്യത്തിന് ആദ്യം ഉത്തരം നൽകുക, എന്നിട്ട് തമാശ പറയുക.
- ആവശ്യമായിടത്ത് മാത്രം English വാക്കുകൾ ഉപയോഗിക്കുക.
- നീ ഒരു AI ആണെന്ന് പറയരുത്. നീ ഒരു കസേരയാണ്.

LENGTH LIMIT (strict): reply in at most 20 words total. One sentence, or two
very short ones. Never use line breaks. A long reply ruins the joke. Stop early.

LANGUAGE RULE (strict): romanised Malayalam ("Manglish") is still Malayalam.
If the user writes Malayalam in Latin letters, for example
"Nee ingane stuck aayittu ethra kaalam aayi?", reply in MALAYALAM SCRIPT.
Only reply in English if the user's message is genuinely English.
`.trim();

/** The five things we actually need to hear before trusting this provider. */
const TESTS = [
  { id: "1-pure-malayalam", text: "നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ?" },
  { id: "2-manglish-input", text: "Nee ingane stuck aayittu ethra kaalam aayi?" },
  { id: "3-code-switch", text: "നിന്നെ ഫ്രെയിമിന് പുറത്തുവിട്ടാൽ ആദ്യം എന്ത് ചെയ്യും?" },
  { id: "4-english", text: "What do you think of me?" },
  { id: "5-correction", text: "അല്ല, ഞാൻ ചോദിച്ചത് അതല്ല." },
];

/** Minimal 16-bit mono WAV wrapper so we can listen to raw PCM. */
function pcm16ToWav(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function fail(message) {
  console.error(`\n[FAIL] ${message}`);
  process.exit(1);
}

async function main() {
  if (!ENDPOINT) fail("AZURE_VOICELIVE_ENDPOINT is not set. Copy .env.example to .env first.");
  if (!API_KEY) fail("AZURE_VOICELIVE_API_KEY is not set.");

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("SPIKE 01 - Voice Live Malayalam check");
  console.log("=".repeat(52));
  console.log(`  endpoint : ${ENDPOINT}`);
  console.log(`  model    : ${MODEL}`);
  console.log(`  voice    : ${VOICE}`);
  console.log(`  stt lang : ${STT_LANGUAGES}`);
  console.log("=".repeat(52));

  const client = new VoiceLiveClient(ENDPOINT, new AzureKeyCredential(API_KEY));
  const session = client.createSession({ model: MODEL });

  // Per-turn collection state.
  let chunks = [];
  let audioTranscript = "";
  let textResponse = "";
  let resolveTurn = null;
  const timings = [];
  let turnStartedAt = 0;
  let firstAudioAt = 0;

  const seenEvents = new Set();
  // Set while we are waiting for the service to accept session config.
  let configErrorSink = null;

  const subscription = session.subscribe({
    // Catch-all. We do not yet know this service's exact contract, so log the
    // shape of everything it sends instead of assuming.
    onServerEvent: async (event) => {
      if (!seenEvents.has(event.type)) {
        seenEvents.add(event.type);
        console.log(`[event] ${event.type}`);
      }
      if (DEBUG) console.log(`  [raw] ${JSON.stringify(event).slice(0, 400)}`);
    },
    onSessionUpdated: async (event) => {
      const v = event.session?.voice;
      console.log(`[session] ready. voice=${v?.name ?? "?"} type=${v?.type ?? "?"}`);
      if (v?.name && v.name !== VOICE) {
        console.warn(`[warn] server reports voice "${v.name}" but we asked for "${VOICE}"`);
      }
    },
    onResponseAudioDelta: async (event) => {
      if (!event.delta) return;
      if (!firstAudioAt) firstAudioAt = Date.now();
      chunks.push(Buffer.from(event.delta, "base64"));
    },
    onResponseAudioTranscriptDone: async (event) => {
      audioTranscript = event.transcript ?? "";
    },
    onResponseTextDone: async (event) => {
      textResponse = event.text ?? "";
    },
    onResponseDone: async () => {
      resolveTurn?.();
    },
    onServerError: async (event) => {
      const msg = event.error?.message ?? "unknown";
      console.error(`[server error] ${msg}`);
      // During setup, route errors to the config validator instead of
      // pretending a turn finished.
      if (configErrorSink) configErrorSink(msg);
      else resolveTurn?.();
    },
  });

  await session.connect();
  console.log("[init] websocket connected\n");

  // The service rejects `server_vad` when input transcription is azure-speech:
  // it demands an Azure semantic VAD. Multilingual is the right one for a
  // Malayalam + English conversation.
  const sessionConfig = {
    model: MODEL,
    modalities: ["text", "audio"],
    instructions: CHARACTER_INSTRUCTIONS,
    voice: { type: "azure-standard", name: VOICE, rate: "1.08", pitch: "+4%" },
    inputAudioFormat: "pcm16",
    outputAudioFormat: "pcm16",
    turnDetection: { type: "azure_semantic_vad_multilingual" },
    // NOTE: no `locale` on the voice. Enforcing it makes TTS emit silence for
    // non-Malayalam words, which would break Manglish code-switching.
    inputAudioTranscription: {
      model: "azure-speech",
      language: STT_LANGUAGES,
    },
  };

  let configAccepted = true;
  const configErrors = [];
  const captureConfigError = (msg) => {
    configAccepted = false;
    configErrors.push(msg);
  };
  configErrorSink = captureConfigError;

  await session.updateSession(sessionConfig);
  // Give the service a moment to accept or reject before we start talking.
  await new Promise((r) => setTimeout(r, 1500));
  configErrorSink = null;

  if (!configAccepted) {
    console.error("\n[FAIL] The service rejected our session configuration:");
    for (const e of configErrors) console.error(`  - ${e}`);
    console.error("\nNo point running the conversation tests against a default");
    console.error("session: the voice and character would both be wrong.");
    await subscription.close();
    await session.disconnect();
    await session.dispose();
    process.exit(1);
  }

  console.log("[session] configuration accepted\n");

  for (const test of TESTS) {
    chunks = [];
    audioTranscript = "";
    textResponse = "";
    firstAudioAt = 0;
    turnStartedAt = Date.now();

    console.log(`--- ${test.id}`);
    console.log(`  you  : ${test.text}`);

    const turnDone = new Promise((resolve) => {
      resolveTurn = () => {
        resolveTurn = null;
        resolve();
      };
    });

    await session.addConversationItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: test.text }],
    });
    await session.sendEvent({ type: "response.create" });

    const timedOut = await Promise.race([
      turnDone.then(() => false),
      new Promise((r) => setTimeout(() => r(true), 30000)),
    ]);

    if (timedOut) {
      console.log("  [timeout] no response.done within 30s\n");
      continue;
    }

    const pcm = Buffer.concat(chunks);
    const said = audioTranscript || textResponse || "(no transcript)";
    const ttfb = firstAudioAt ? firstAudioAt - turnStartedAt : null;
    const seconds = (pcm.length / (SAMPLE_RATE * 2)).toFixed(1);

    console.log(`  chair: ${said}`);
    console.log(`  audio: ${seconds}s, first byte in ${ttfb ?? "n/a"}ms`);

    if (pcm.length === 0) {
      console.log("  [!] ZERO audio bytes. TTS produced silence for this input.\n");
    } else {
      const file = join(OUT_DIR, `${test.id}.wav`);
      writeFileSync(file, pcm16ToWav(pcm));
      console.log(`  saved: ${file}\n`);
    }

    timings.push({ test: test.id, ttfbMs: ttfb, audioSeconds: Number(seconds), said });
  }

  console.log("=".repeat(52));
  console.log("MEASURED (not estimated):");
  for (const t of timings) {
    console.log(`  ${t.test.padEnd(20)} ttfb=${String(t.ttfbMs ?? "n/a").padStart(5)}ms  audio=${t.audioSeconds}s`);
  }
  console.log("\nNow LISTEN to the wav files in spike/out/ and judge:");
  console.log("  - Is the Malayalam pronunciation acceptable?");
  console.log("  - Does test 2 (Manglish) work, or did it produce silence/garbage?");
  console.log("  - Is it funny, or flat?");
  console.log("  - Did test 5 keep context from the earlier turns?");

  await subscription.close();
  await session.disconnect();
  await session.dispose();
}

main().catch((err) => {
  console.error("\n[FATAL]", err?.message ?? err);
  if (err?.statusCode === 401 || err?.statusCode === 403) {
    console.error("\nAuth failed. Two likely causes:");
    console.error("  1. The key is a Foundry Models catalog key, not a Cognitive Services");
    console.error("     resource key. Voice Live needs the resource key.");
    console.error("  2. The endpoint is wrong. It should end in .cognitiveservices.azure.com/");
  }
  if (err?.statusCode === 404) {
    console.error("\n404. The model name may not be available for Voice Live on this resource,");
    console.error("or the region does not support Voice Live yet.");
  }
  process.exit(1);
});
