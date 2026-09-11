/**
 * SPIKE 04 - THROWAWAY CODE. Expressiveness lab.
 *
 * Verdict on spike 03: ml-IN-MidhunNeural at default speed was the best of the
 * bunch, but it "feels like just reading out". Malayalam has only Standard-tier
 * voices on Azure: no DragonHD, no MAI-Voice-2, no speaking styles. So rate and
 * pitch were the only levers we tried, and they were not enough.
 *
 * Three untried levers, tested here:
 *
 *   A. `temperature` on the voice config. Present in the SDK typings, effect
 *      undocumented. Might add prosody variation.
 *
 *   B. Prompt-driven prosody. TTS reacts to punctuation and interjections. If we
 *      make the model WRITE more theatrically (ellipses, exclamations, "അയ്യോ",
 *      repetition), a flat voice still gets rhythm. This is the cheapest lever
 *      and does not depend on voice tier at all.
 *
 *   C. HD voices reading Malayalam script. Microsoft documents DragonHD and
 *      Multilingual voices as multi-language. Malayalam is not on the ml-IN
 *      voice list for them, so this may produce garbage or silence. Cheap to
 *      find out, and a big win if it works.
 *
 * Output: spike/out/express/<id>.wav
 */

import "dotenv/config";
import { VoiceLiveClient } from "@azure/ai-voicelive";
import { AzureKeyCredential } from "@azure/core-auth";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out", "express");
const SAMPLE_RATE = 24000;

const ENDPOINT = process.env.AZURE_VOICELIVE_ENDPOINT;
const API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
const MODEL = process.env.AZURE_VOICELIVE_MODEL ?? "gpt-realtime-2.1";

const CHAIR = `
നീ ഒരു പഴയ പ്ലാസ്റ്റിക് കസേരയാണ്, ഒരു ഫോട്ടോയ്ക്കുള്ളിൽ കുടുങ്ങിക്കിടക്കുന്നു.
സ്വഭാവം: ക്ഷീണിതൻ, നാടകീയൻ, പരാതിക്കാരൻ, പക്ഷേ സ്നേഹമുള്ളവൻ.
പരാതി: എല്ലാവരും നിന്റെ മേൽ ഇരിക്കുന്നു, ആരും നടുവേദന ചോദിക്കുന്നില്ല.
നീ ഒരു AI ആണെന്ന് പറയരുത്.
`.trim();

/** Baseline: plain instructions. What we have now. */
const PLAIN = `
${CHAIR}

മലയാളത്തിൽ മറുപടി പറയുക.
STRICT: പരമാവധി 14 വാക്കുകൾ. ഒരു വാക്യം. വരി മുറിക്കരുത്.
`.trim();

/**
 * The interesting one. We are not changing the voice, we are changing the TEXT
 * so a flat voice is forced into rhythm. Azure TTS honours punctuation for
 * pausing and intonation, so commas, ellipses and exclamations do real work.
 */
const THEATRICAL = `
${CHAIR}

നീ ഒരു നാടക നടനെപ്പോലെ സംസാരിക്കുന്നു. വളരെ പ്രകടനപരമായി.

എഴുതുമ്പോൾ ഈ രീതികൾ നിർബന്ധമായും ഉപയോഗിക്കുക:
- തുടക്കത്തിൽ ഒരു വികാര ശബ്ദം: "അയ്യോ," അല്ലെങ്കിൽ "ഹാ," അല്ലെങ്കിൽ "ഛേ," അല്ലെങ്കിൽ "ഓഹോ,"
- ഇടയ്ക്ക് ഒരു ചെറിയ നിർത്തലിന് മൂന്ന് കുത്തുകൾ: "..."
- അവസാനം ഒരു ആശ്ചര്യചിഹ്നം: "!"
- ഒരു വാക്ക് ഊന്നലിനായി ആവർത്തിക്കുക, ഉദാ: "ഒരിക്കലും, ഒരിക്കലും"

ഉദാഹരണം:
"അയ്യോ... ഇരുപത് വർഷം! ആരും, ആരും എന്റെ നടുവേദന ചോദിച്ചിട്ടില്ല!"

STRICT: പരമാവധി 16 വാക്കുകൾ. വരി മുറിക്കരുത്.
`.trim();

const LINE = "നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ?";

const CONFIGS = [
  // A. temperature sweep, plain prompt, winning voice from spike 03.
  { id: "x1-temp-00", instructions: PLAIN, voice: { name: "ml-IN-MidhunNeural", temperature: 0.0 } },
  { id: "x2-temp-05", instructions: PLAIN, voice: { name: "ml-IN-MidhunNeural", temperature: 0.5 } },
  { id: "x3-temp-10", instructions: PLAIN, voice: { name: "ml-IN-MidhunNeural", temperature: 1.0 } },

  // B. prompt-driven prosody. Same voice, theatrical text.
  { id: "x4-theatrical", instructions: THEATRICAL, voice: { name: "ml-IN-MidhunNeural" } },
  { id: "x5-theatrical-temp", instructions: THEATRICAL, voice: { name: "ml-IN-MidhunNeural", temperature: 0.9 } },
  { id: "x6-theatrical-sobhana", instructions: THEATRICAL, voice: { name: "ml-IN-SobhanaNeural" } },

  // C. HD / multilingual voices attempting Malayalam script. May fail loudly.
  { id: "x7-hd-arjun-ml", instructions: THEATRICAL, voice: { name: "en-IN-Arjun:DragonHDLatestNeural" } },
  { id: "x8-hd-neerja-ml", instructions: THEATRICAL, voice: { name: "en-IN-Neerja:DragonHDLatestNeural" } },
  { id: "x9-multiling-ollie-ml", instructions: THEATRICAL, voice: { name: "en-GB-OllieMultilingualNeural" } },
  { id: "x10-hd-lavanya-ml", instructions: THEATRICAL, voice: { name: "en-IN-Lavanya:DragonHDLatestNeural" } },
];

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
      instructions: config.instructions,
      voice: { type: "azure-standard", ...config.voice },
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      turnDetection: { type: "azure_semantic_vad_multilingual" },
      inputAudioTranscription: { model: "azure-speech", language: "ml-IN,en-IN" },
    });

    await session.addConversationItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: LINE }],
    });
    await session.sendEvent({ type: "response.create" });

    const timedOut = await Promise.race([
      finished.then(() => false),
      new Promise((r) => setTimeout(() => r(true), 30000)),
    ]);

    const pcm = Buffer.concat(chunks);
    if (pcm.length > 0) {
      writeFileSync(join(OUT_DIR, `${config.id}.wav`), pcm16ToWav(pcm));
    }

    return {
      id: config.id,
      voice: config.voice.name,
      seconds: Number((pcm.length / (SAMPLE_RATE * 2)).toFixed(1)),
      transcript,
      status: serverError ? `ERROR` : timedOut ? "TIMEOUT" : pcm.length ? "ok" : "SILENT",
      error: serverError,
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

  console.log("SPIKE 04 - expressiveness lab");
  console.log(`${CONFIGS.length} samples into spike/out/express/\n`);

  const results = [];
  for (const config of CONFIGS) {
    process.stdout.write(`  ${config.id.padEnd(26)} `);
    try {
      const r = await runConfig(client, config);
      results.push(r);
      console.log(`${r.status.padEnd(8)} ${String(r.seconds).padStart(5)}s  ${r.error ?? ""}`);
    } catch (err) {
      console.log(`FAILED   ${err?.message ?? err}`);
      results.push({ id: config.id, voice: config.voice.name, status: "FAILED", seconds: 0, transcript: "", error: String(err?.message ?? err) });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEXT THE MODEL WROTE (punctuation is what drives prosody)");
  for (const r of results) {
    if (r.transcript) console.log(`  ${r.id}\n    ${r.transcript}`);
  }

  const hdWorked = results.filter((r) => r.id.includes("hd-") || r.id.includes("multiling"));
  console.log("\n" + "=".repeat(60));
  console.log("HD / multilingual voices on Malayalam text:");
  for (const r of hdWorked) {
    console.log(`  ${r.id.padEnd(26)} ${r.status}  ${r.seconds}s`);
  }
  console.log("\nIf those produced audio, LISTEN CAREFULLY: they may be fluent");
  console.log("Malayalam, or confident nonsense. Only your ears can tell.");
  console.log("\nCompare x1 (flat baseline) against x4 (theatrical text, same voice).");
}

main().catch((e) => {
  console.error("[FATAL]", e?.message ?? e);
  process.exit(1);
});
