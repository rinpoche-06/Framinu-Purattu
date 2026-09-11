/**
 * SPIKE 05 - THROWAWAY CODE. Manglish lab.
 *
 * Decision from spike 04: stay on ml-IN-MidhunNeural (Standard tier, flat) and
 * make the WRITING carry the comedy instead of chasing voice expressiveness
 * Azure does not offer for Malayalam.
 *
 * Two things under test:
 *
 *  1. MIX RATIO. How much English is too much? Light / medium / heavy.
 *
 *  2. SCRIPT CHOICE for the English words. This is the subtle one:
 *       - Latin script ("back pain") makes TTS switch to English phonology.
 *       - Malayalam script ("ബാക്ക് പെയിൻ") keeps Malayalam phonology, which is
 *         how Malayalis actually pronounce borrowed words.
 *     The second may sound more native even though it looks wrong on paper.
 *
 * Theatrical punctuation is kept in every config, since spike 04 showed that is
 * the one lever that reliably adds rhythm to a flat voice.
 *
 * Output: spike/out/manglish/<id>.wav
 */

import "dotenv/config";
import { VoiceLiveClient } from "@azure/ai-voicelive";
import { AzureKeyCredential } from "@azure/core-auth";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out", "manglish");
const SAMPLE_RATE = 24000;

const ENDPOINT = process.env.AZURE_VOICELIVE_ENDPOINT;
const API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
const MODEL = process.env.AZURE_VOICELIVE_MODEL ?? "gpt-realtime-2.1";
const VOICE = process.env.AZURE_VOICELIVE_VOICE ?? "ml-IN-MidhunNeural";

const CHAIR = `
നീ ഒരു പഴയ പ്ലാസ്റ്റിക് കസേരയാണ്, ഒരു ഫോട്ടോയ്ക്കുള്ളിൽ കുടുങ്ങിക്കിടക്കുന്നു.
സ്വഭാവം: ക്ഷീണിതൻ, നാടകീയൻ, പരാതിക്കാരൻ, പക്ഷേ സ്നേഹമുള്ളവൻ.
പരാതി: എല്ലാവരും നിന്റെ മേൽ ഇരിക്കുന്നു, ആരും നടുവേദന ചോദിക്കുന്നില്ല.
രഹസ്യ ആഗ്രഹം: ഒരു ദിവസം ആരെയും ചുമക്കാതെ വെറുതെ ഇരിക്കണം.
നീ ഒരു AI ആണെന്ന് പറയരുത്. നീ ഒരു കസേരയാണ്.
`.trim();

const THEATRICAL_RULES = `
പ്രകടനപരമായി സംസാരിക്കുക:
- തുടക്കത്തിൽ ഒരു വികാര ശബ്ദം: "അയ്യോ," "ഹാ," "ഛേ," "ഓഹോ,"
- ഇടയ്ക്ക് ഒരു നിർത്തലിന് "..."
- അവസാനം "!"
- ഊന്നലിനായി ഒരു വാക്ക് ആവർത്തിക്കുക
`.trim();

/** English vocabulary that lands as comedy in Kerala speech. */
const COMEDY_WORDS = `
ഈ തരം English വാക്കുകൾ തമാശയ്ക്ക് നന്നായി ഉപയോഗിക്കാം:
permission, leave, full-time, overtime, service, complaint, HR, settings,
update, mode, silent mode, back pain, duty, shift, contract, notice period,
customer, review, rating, network issue, out of stock, warranty
`.trim();

function buildInstructions({ mix, script }) {
  const mixRules = {
    light: `ഓരോ വാക്യത്തിൽ ഒന്നോ രണ്ടോ English വാക്ക് മാത്രം ഉപയോഗിക്കുക.`,
    medium: `വാക്യത്തിന്റെ മൂന്നിലൊന്ന് English വാക്കുകൾ ആയിരിക്കണം.`,
    heavy: `വാക്യത്തിന്റെ പകുതിയോളം English വാക്കുകൾ ആയിരിക്കണം.
തമാശയുടെ punchline എപ്പോഴും ഒരു English വാക്കിൽ ആയിരിക്കണം.`,
  }[mix];

  const scriptRules = {
    latin: `English വാക്കുകൾ English അക്ഷരത്തിൽ തന്നെ എഴുതുക. ഉദാ: "back pain", "permission".`,
    malayalam: `English വാക്കുകൾ മലയാളം അക്ഷരത്തിൽ എഴുതുക, ഒരു മലയാളി ഉച്ചരിക്കുന്നതുപോലെ.
ഉദാ: "ബാക്ക് പെയിൻ", "പെർമിഷൻ", "ഫുൾ ടൈം".`,
    free: `English വാക്കുകൾ ഏത് അക്ഷരത്തിൽ എഴുതണമെന്ന് നീ തീരുമാനിക്കുക.`,
  }[script];

  return `
${CHAIR}

നീ Manglish-ൽ സംസാരിക്കുന്നു: മലയാളം വ്യാകരണം, ഇടയ്ക്ക് English വാക്കുകൾ.
ഒരു സാധാരണ മലയാളി സുഹൃത്തിനോട് സംസാരിക്കുന്നതുപോലെ.

${mixRules}

${scriptRules}

${COMEDY_WORDS}

${THEATRICAL_RULES}

STRICT: പരമാവധി 16 വാക്കുകൾ. ഒരു വാക്യം. വരി മുറിക്കരുത്.
ഉപയോക്താവിന്റെ ചോദ്യത്തിന് ഉത്തരം നൽകുക, എന്നിട്ട് തമാശ.
`.trim();
}

const BORED = "നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ?";

const CONFIGS = [
  // Part 1: same question, vary the mix ratio and script. Straight A/B.
  { id: "m1-light-latin", mix: "light", script: "latin", q: BORED },
  { id: "m2-medium-latin", mix: "medium", script: "latin", q: BORED },
  { id: "m3-heavy-latin", mix: "heavy", script: "latin", q: BORED },
  { id: "m4-heavy-mlscript", mix: "heavy", script: "malayalam", q: BORED },
  { id: "m5-medium-mlscript", mix: "medium", script: "malayalam", q: BORED },
  { id: "m6-heavy-free", mix: "heavy", script: "free", q: BORED },

  // Part 2: comedy range. Heavy mix, different questions, to check it is funny
  // across situations and not just on one lucky line.
  { id: "m7-escape", mix: "heavy", script: "latin", q: "നിന്നെ ഫ്രെയിമിന് പുറത്തുവിട്ടാൽ ആദ്യം എന്ത് ചെയ്യും?" },
  { id: "m8-dubai", mix: "heavy", script: "latin", q: "എന്നെ ദുബായിൽ കൊണ്ടുപോകാമോ?" },
  { id: "m9-roast", mix: "heavy", script: "latin", q: "എന്നെക്കുറിച്ച് നിന്റെ അഭിപ്രായം എന്താ?" },
  { id: "m10-manglish-input", mix: "heavy", script: "latin", q: "Nee ingane stuck aayittu ethra kaalam aayi?" },
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

/** Rough check of how much Latin-script English made it into the reply. */
function englishRatio(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const latin = words.filter((w) => /[A-Za-z]/.test(w)).length;
  return Math.round((latin / words.length) * 100);
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
      instructions: buildInstructions(config),
      voice: { type: "azure-standard", name: VOICE },
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      turnDetection: { type: "azure_semantic_vad_multilingual" },
      inputAudioTranscription: { model: "azure-speech", language: "ml-IN,en-IN" },
    });

    await session.addConversationItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: config.q }],
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
      seconds: Number((pcm.length / (SAMPLE_RATE * 2)).toFixed(1)),
      transcript,
      question: config.q,
      englishPct: englishRatio(transcript),
      status: serverError ? "ERROR" : timedOut ? "TIMEOUT" : pcm.length ? "ok" : "SILENT",
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

  console.log("SPIKE 05 - Manglish lab");
  console.log(`voice: ${VOICE}   samples: ${CONFIGS.length}\n`);

  const results = [];
  for (const config of CONFIGS) {
    process.stdout.write(`  ${config.id.padEnd(22)} `);
    try {
      const r = await runConfig(client, config);
      results.push(r);
      console.log(`${r.status.padEnd(7)} ${String(r.seconds).padStart(5)}s  eng=${String(r.englishPct).padStart(3)}%`);
    } catch (err) {
      console.log(`FAILED  ${err?.message ?? err}`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log("PART 1 - mix ratio and script (same question)");
  for (const r of results.slice(0, 6)) {
    console.log(`\n  ${r.id}  [${r.englishPct}% latin words]`);
    console.log(`    ${r.transcript}`);
  }

  console.log("\n" + "=".repeat(64));
  console.log("PART 2 - comedy range (heavy mix, different questions)");
  for (const r of results.slice(6)) {
    console.log(`\n  ${r.id}`);
    console.log(`    Q: ${r.question}`);
    console.log(`    A: ${r.transcript}`);
  }

  console.log("\n" + "=".repeat(64));
  console.log("LISTEN in spike/out/manglish/");
  console.log("  m3 vs m4: same heavy mix, Latin vs Malayalam script for the");
  console.log("            English words. This is the pronunciation question.");
  console.log("  m1 vs m2 vs m3: how much English feels natural.");
  console.log("  m7 to m10: is it actually funny across different questions?");
}

main().catch((e) => {
  console.error("[FATAL]", e?.message ?? e);
  process.exit(1);
});
