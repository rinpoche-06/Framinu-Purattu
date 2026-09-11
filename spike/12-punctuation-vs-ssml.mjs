/**
 * SPIKE 12 - can punctuation get us what SSML got us?
 *
 * Again: this script changes nothing. It writes wav files only.
 *
 * Spike 11 showed that full SSML (variant 7) sounds better and funnier. But
 * Voice Live cannot send SSML, so using it would mean abandoning the streaming
 * realtime session and rebuilding barge-in and truncation by hand.
 *
 * Before paying that price, a cheaper hypothesis: most of 7's improvement came
 * from PAUSES, and Azure TTS produces pauses from ordinary punctuation. Ellipses,
 * full stops and exclamation marks all shift timing and intonation with no
 * markup at all.
 *
 * If punctuation-only plain text lands close to 7, we get the win by editing the
 * character prompt — no architecture change, no risk to the working demo.
 *
 * Honest limit: punctuation cannot reproduce per-word pitch stress. So the best
 * realistic outcome here is "most of 7, for free".
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out", "punctuation");

const API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
const REGION = process.env.AZURE_SPEECH_REGION ?? "eastus2";
const TTS_URL = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
const VOICE = "ml-IN-MidhunNeural";

const escapeXml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(inner) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ml-IN"><voice name="${VOICE}">${inner}</voice></speak>`;
}

/** Plain text: what the model could actually produce with prompt changes. */
const plain = (text) => wrap(escapeXml(text));

const VARIANTS = [
  {
    id: "a-current-commas",
    note: "commas only, closest to what we ship now",
    body: plain("അയ്യോ, എന്തെങ്കിലും പറയൂ, ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല, ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!"),
  },
  {
    id: "b-ellipses",
    note: "ellipses instead of commas",
    body: plain("അയ്യോ... എന്തെങ്കിലും പറയൂ... ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല... ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!"),
  },
  {
    id: "c-short-sentences",
    note: "full stops, which give both a pause and falling intonation",
    body: plain("അയ്യോ. എന്തെങ്കിലും പറയൂ. ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല. ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!"),
  },
  {
    id: "d-mixed-punctuation",
    note: "ellipsis opener, then short sentences, then exclamation",
    body: plain("അയ്യോ... എന്തെങ്കിലും പറയൂ. ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല. ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!"),
  },
  {
    id: "e-question-and-bang",
    note: "a question in the middle for rising intonation",
    body: plain("അയ്യോ... ഒന്നും പറയില്ലേ? ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല. ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!"),
  },
  {
    id: "f-heavy-punctuation",
    note: "everything punctuation can do: ellipses, stops, question, bang",
    body: plain("അയ്യോ... എന്തെങ്കിലും പറയൂ! ഒന്നും പറയില്ലേ? ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല... ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!"),
  },
  {
    id: "z-ssml-reference",
    note: "SSML variant 7 from spike 11, the target to match",
    body: wrap(
      `<prosody contour="(0%,+10%) (50%,+18%) (100%,-12%)">` +
        `<prosody pitch="+20%" rate="0.88">അയ്യോ</prosody><break time="420ms"/> ` +
        `എന്തെങ്കിലും പറയൂ<break time="320ms"/> ` +
        `ഞാൻ <prosody pitch="+14%">കസേര പ്രവചന യന്ത്രമല്ല</prosody><break time="220ms"/> ` +
        `ഫോട്ടോയുടെ ചുറ്റളം <prosody pitch="+16%" rate="0.9">എന്റെ ദേശം</prosody>!` +
        `</prosody>`,
    ),
  },
];

async function synthesise(body) {
  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": API_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
      "User-Agent": "framinu-purathu-spike",
    },
    body,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180).replace(/\s+/g, " ");
    return { ok: false, detail: `${response.status} ${detail}` };
  }
  return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
}

async function main() {
  if (!API_KEY) {
    console.error("[FAIL] AZURE_VOICELIVE_API_KEY is not set in .env");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("SPIKE 12 - punctuation versus SSML");
  console.log("Nothing in the app is modified. Output: spike/out/punctuation/\n");

  const results = [];
  for (const variant of VARIANTS) {
    process.stdout.write(`  ${variant.id.padEnd(22)} `);
    const result = await synthesise(variant.body);
    if (!result.ok) {
      console.log(`FAILED  ${result.detail}`);
      continue;
    }
    const seconds = Number(((result.bytes.length - 44) / 48000).toFixed(1));
    writeFileSync(join(OUT_DIR, `${variant.id}.wav`), result.bytes);
    console.log(`ok  ${String(seconds).padStart(5)}s  ${variant.note}`);
    results.push({ id: variant.id, seconds });
  }

  const target = results.find((r) => r.id === "z-ssml-reference");
  const current = results.find((r) => r.id === "a-current-commas");

  console.log("\n" + "=".repeat(62));
  if (target && current) {
    console.log(`today's commas : ${current.seconds}s`);
    console.log(`SSML target    : ${target.seconds}s`);
    console.log("\nduration gap to the SSML target (longer = more pausing):");
    for (const r of results) {
      if (r.id === "z-ssml-reference") continue;
      const gap = (target.seconds - r.seconds).toFixed(1);
      const marker = Math.abs(target.seconds - r.seconds) <= 0.4 ? "  <- matches pacing" : "";
      console.log(`  ${r.id.padEnd(22)} ${String(r.seconds).padStart(5)}s  gap ${gap}s${marker}`);
    }
  }

  console.log("\nLISTEN: play z-ssml-reference, then find the punctuation-only");
  console.log("variant that comes closest to it.");
  console.log("\nIf one gets close, we change the PROMPT and nothing else:");
  console.log("no architecture change, no risk to the working demo.");
  console.log("Duration only measures pausing, so trust your ears over the numbers.");
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
