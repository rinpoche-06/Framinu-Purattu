/**
 * SPIKE 03 - THROWAWAY CODE. Voice A/B lab.
 *
 * Problem this solves: test 4 of spike 01 was unintelligible. Cause: we made a
 * MONOLINGUAL Malayalam voice (ml-IN-MidhunNeural) speak a full English
 * sentence. Embedded English words are fine, whole English sentences are not.
 *
 * So the app needs language mode -> voice mapping, not one voice for everything.
 *
 * This script speaks the SAME line through several voice configs and saves each
 * one, so you can listen back to back and pick. It cannot judge comic delivery.
 * You can.
 *
 * Output: spike/out/voices/<id>.wav
 */

import "dotenv/config";
import { VoiceLiveClient } from "@azure/ai-voicelive";
import { AzureKeyCredential } from "@azure/core-auth";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out", "voices");
const SAMPLE_RATE = 24000;

const ENDPOINT = process.env.AZURE_VOICELIVE_ENDPOINT;
const API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
const MODEL = process.env.AZURE_VOICELIVE_MODEL ?? "gpt-realtime-2.1";

const CHAIR_BASE = `
നീ ഒരു പഴയ പ്ലാസ്റ്റിക് കസേരയാണ്, ഒരു ഫോട്ടോയ്ക്കുള്ളിൽ കുടുങ്ങിക്കിടക്കുന്നു.
സ്വഭാവം: ക്ഷീണിതൻ, പരാതിക്കാരൻ, പക്ഷേ സ്നേഹമുള്ളവൻ.
പരാതി: എല്ലാവരും നിന്റെ മേൽ ഇരിക്കുന്നു, ആരും നടുവേദന ചോദിക്കുന്നില്ല.
നീ ഒരു AI ആണെന്ന് പറയരുത്.
`.trim();

const MALAYALAM_RULES = `
${CHAIR_BASE}

മലയാളത്തിൽ മാത്രം മറുപടി പറയുക. ആവശ്യമായിടത്ത് മാത്രം English വാക്കുകൾ.
STRICT: പരമാവധി 14 വാക്കുകൾ. ഒരു വാക്യം. വരി മുറിക്കരുത്.
`.trim();

const ENGLISH_RULES = `
${CHAIR_BASE}

Reply in English only.
STRICT: at most 14 words. One sentence. No line breaks.
`.trim();

const ML_LINE = "നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ?";
const EN_LINE = "What do you think of me?";

/**
 * Malayalam has only Standard-tier voices (no DragonHD, no MAI-Voice-2, no
 * styles), so rate and pitch are the only expressiveness levers we have.
 * English has Neural HD voices, which are far more natural.
 */
const SETS = {
  // Round 1: broad sweep. Verdict: en-IN-Arjun HD wins for English.
  // ml-6 at rate 1.12 sounded fast-forwarded, so round 2 goes slower.
  round1: [
    { id: "ml-1-midhun-plain", lang: "ml", voice: { name: "ml-IN-MidhunNeural" } },
    { id: "ml-2-midhun-tuned", lang: "ml", voice: { name: "ml-IN-MidhunNeural", rate: "1.08", pitch: "+4%" } },
    { id: "ml-3-midhun-lively", lang: "ml", voice: { name: "ml-IN-MidhunNeural", rate: "1.15", pitch: "+10%" } },
    { id: "ml-4-midhun-grumpy", lang: "ml", voice: { name: "ml-IN-MidhunNeural", rate: "0.92", pitch: "-6%" } },
    { id: "ml-5-sobhana-plain", lang: "ml", voice: { name: "ml-IN-SobhanaNeural" } },
    { id: "ml-6-sobhana-tuned", lang: "ml", voice: { name: "ml-IN-SobhanaNeural", rate: "1.12", pitch: "+6%" } },
    { id: "en-1-arjun-hd", lang: "en", voice: { name: "en-IN-Arjun:DragonHDLatestNeural" } },
    { id: "en-2-prabhat", lang: "en", voice: { name: "en-IN-PrabhatNeural" } },
    { id: "en-3-aarav", lang: "en", voice: { name: "en-IN-AaravNeural" } },
    // Control: the broken combination from spike 01. Malayalam voice, English
    // text. Keep it so the difference is audible and documented.
    { id: "xx-broken-ml-voice-en-text", lang: "en", voice: { name: "ml-IN-MidhunNeural" } },
  ],

  // Round 2: Malayalam only, at and below normal speed. Round 1 showed anything
  // at 1.1x or above sounds rushed on Standard-tier ml-IN voices.
  slow: [
    { id: "s1-midhun-100", lang: "ml", voice: { name: "ml-IN-MidhunNeural" } },
    { id: "s2-midhun-095", lang: "ml", voice: { name: "ml-IN-MidhunNeural", rate: "0.95", pitch: "-2%" } },
    { id: "s3-midhun-090", lang: "ml", voice: { name: "ml-IN-MidhunNeural", rate: "0.90", pitch: "-5%" } },
    { id: "s4-midhun-085", lang: "ml", voice: { name: "ml-IN-MidhunNeural", rate: "0.85", pitch: "-8%" } },
    { id: "s5-sobhana-100", lang: "ml", voice: { name: "ml-IN-SobhanaNeural" } },
    { id: "s6-sobhana-095", lang: "ml", voice: { name: "ml-IN-SobhanaNeural", rate: "0.95", pitch: "-2%" } },
    { id: "s7-sobhana-090", lang: "ml", voice: { name: "ml-IN-SobhanaNeural", rate: "0.90", pitch: "-4%" } },
  ],
};

const SET_NAME = process.argv[2] ?? "round1";
const CONFIGS = SETS[SET_NAME];
if (!CONFIGS) {
  console.error(`Unknown set "${SET_NAME}". Options: ${Object.keys(SETS).join(", ")}`);
  process.exit(1);
}

function pcm16ToWav(pcm, sampleRate = SAMPLE_RATE) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** One config = one fresh session. Voice changes mid-session are not assumed. */
async function runConfig(client, config) {
  const session = client.createSession({ model: MODEL });
  const chunks = [];
  let transcript = "";
  let serverError = null;
  let done = null;
  const finished = new Promise((r) => (done = r));

  const sub = session.subscribe({
    onResponseAudioDelta: async (e) => {
      if (e.delta) chunks.push(Buffer.from(e.delta, "base64"));
    },
    onResponseAudioTranscriptDone: async (e) => {
      transcript = e.transcript ?? "";
    },
    onResponseDone: async () => done?.(),
    onServerError: async (e) => {
      serverError = e.error?.message ?? "unknown";
      done?.();
    },
  });

  try {
    await session.connect();
    await session.updateSession({
      model: MODEL,
      modalities: ["text", "audio"],
      instructions: config.lang === "ml" ? MALAYALAM_RULES : ENGLISH_RULES,
      voice: { type: "azure-standard", ...config.voice },
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      turnDetection: { type: "azure_semantic_vad_multilingual" },
      inputAudioTranscription: { model: "azure-speech", language: "ml-IN,en-IN" },
    });

    await session.addConversationItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: config.lang === "ml" ? ML_LINE : EN_LINE }],
    });
    await session.sendEvent({ type: "response.create" });

    const timedOut = await Promise.race([
      finished.then(() => false),
      new Promise((r) => setTimeout(() => r(true), 30000)),
    ]);

    const pcm = Buffer.concat(chunks);
    const seconds = Number((pcm.length / (SAMPLE_RATE * 2)).toFixed(1));

    if (pcm.length > 0) {
      writeFileSync(join(OUT_DIR, `${config.id}.wav`), pcm16ToWav(pcm));
    }

    return {
      id: config.id,
      voice: config.voice.name,
      seconds,
      words: transcript.trim().split(/\s+/).filter(Boolean).length,
      transcript,
      status: serverError ? `ERROR: ${serverError}` : timedOut ? "TIMEOUT" : pcm.length ? "ok" : "SILENT",
    };
  } finally {
    await sub.close().catch(() => {});
    await session.disconnect().catch(() => {});
    await session.dispose().catch(() => {});
  }
}

async function main() {
  if (!ENDPOINT || !API_KEY) {
    console.error("[FAIL] Set AZURE_VOICELIVE_ENDPOINT and AZURE_VOICELIVE_API_KEY in .env");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const client = new VoiceLiveClient(ENDPOINT, new AzureKeyCredential(API_KEY));

  console.log("SPIKE 03 - voice A/B lab");
  console.log(`Generating ${CONFIGS.length} samples into spike/out/voices/\n`);

  const results = [];
  for (const config of CONFIGS) {
    process.stdout.write(`  ${config.id.padEnd(30)} `);
    try {
      const r = await runConfig(client, config);
      results.push(r);
      console.log(`${r.status.padEnd(8)} ${r.seconds}s  ${r.words}w`);
    } catch (err) {
      console.log(`FAILED  ${err?.message ?? err}`);
      results.push({ id: config.id, voice: config.voice.name, status: "FAILED", seconds: 0, words: 0, transcript: "" });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TRANSCRIPTS");
  for (const r of results) {
    if (r.transcript) console.log(`  ${r.id}\n    ${r.transcript}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("LISTEN in spike/out/voices/ and pick one Malayalam and one English.");
  console.log("Compare xx-broken-ml-voice-en-text against en-1-arjun-hd:");
  console.log("that is the exact bug you heard in test 4.");
}

main().catch((e) => {
  console.error("[FATAL]", e?.message ?? e);
  process.exit(1);
});
