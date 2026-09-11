/**
 * SPIKE 13 - Sarvam Bulbul v3 Malayalam, versus what we ship today.
 *
 * READ FIRST: this script changes nothing in the application. It writes wav
 * files to spike/out/sarvam/ and nothing else. server/ and src/ are untouched.
 *
 * Three questions, in order of importance:
 *
 *  1. Is Bulbul's Malayalam clearly better than ml-IN-MidhunNeural? Compare
 *     against spike/out/punctuation/a-current-commas.wav (today) and
 *     z-ssml-reference.wav (the SSML version that sounded better).
 *
 *  2. DOES MANGLISH WORK? Sarvam claims code-mixed Indic text is trained for,
 *     not patched around. Azure's Standard-tier voice made mixed script
 *     unintelligible, which is why the character is pure Malayalam today. If
 *     Bulbul handles it, that reopens the register originally wanted.
 *
 *  3. Do pace controls help the comic timing?
 *
 * Cost: about 700 characters total, roughly ₹2 at ₹3 per 1000.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out", "sarvam");

const API_KEY = process.env.SARVAM_API_KEY;
const URL = "https://api.sarvam.ai/text-to-speech";
const MODEL = "bulbul:v3";
const LANGUAGE = "ml-IN";

/** Identical to the line used in spikes 11 and 12, so the A/B is fair. */
const CHAIR_COMMAS =
  "അയ്യോ, എന്തെങ്കിലും പറയൂ, ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല, ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!";

/** Graded punctuation: ellipsis long, full stop medium, comma short. */
const CHAIR_GRADED =
  "അയ്യോ... എന്തെങ്കിലും പറയൂ. ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല, ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!";

/** The line that came out unintelligible on Azure. The real test. */
const MANGLISH =
  "അയ്യോ, മടുത്തു... എനിക്ക് leave ഇല്ല, back pain ആരും ചോദിക്കില്ല, ഒരിക്കൽ silent mode വേണം!";

const VARIANTS = [
  { id: "1-shubh-commas", text: CHAIR_COMMAS, speaker: "shubh", note: "male, same text as today" },
  { id: "2-shubh-graded", text: CHAIR_GRADED, speaker: "shubh", note: "male, graded punctuation" },
  { id: "3-ishita-graded", text: CHAIR_GRADED, speaker: "ishita", note: "female, graded punctuation" },
  { id: "4-shubh-MANGLISH", text: MANGLISH, speaker: "shubh", note: "*** the code-mixing test ***" },
  { id: "5-ishita-MANGLISH", text: MANGLISH, speaker: "ishita", note: "code-mixing, female" },
  { id: "6-shubh-slow", text: CHAIR_GRADED, speaker: "shubh", pace: 0.9, note: "pace 0.9" },
  { id: "7-shubh-quick", text: CHAIR_GRADED, speaker: "shubh", pace: 1.1, note: "pace 1.1" },
];

async function synthesise(variant) {
  const payload = {
    text: variant.text,
    target_language_code: LANGUAGE,
    model: MODEL,
    speaker: variant.speaker,
  };
  // Only sent when set, so an unsupported parameter cannot spoil the baseline.
  if (variant.pace !== undefined) payload.pace = variant.pace;

  const response = await fetch(URL, {
    method: "POST",
    headers: {
      "api-subscription-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();

  if (!response.ok) {
    return { ok: false, detail: `${response.status} ${raw.slice(0, 220).replace(/\s+/g, " ")}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, detail: `unparseable response: ${raw.slice(0, 120)}` };
  }

  // Documented shape is { audios: [base64] }, but stay tolerant and report
  // the actual keys if it differs rather than failing opaquely.
  const base64 = Array.isArray(parsed.audios) ? parsed.audios[0] : parsed.audio;
  if (!base64) {
    return { ok: false, detail: `no audio in response. keys: ${Object.keys(parsed).join(", ")}` };
  }

  return { ok: true, bytes: Buffer.from(base64, "base64") };
}

async function main() {
  if (!API_KEY) {
    console.error("[FAIL] SARVAM_API_KEY is not set in .env");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("SPIKE 13 - Sarvam Bulbul v3 Malayalam");
  console.log("Nothing in the app is modified. Output: spike/out/sarvam/\n");
  console.log(`model ${MODEL}   language ${LANGUAGE}\n`);

  let characters = 0;
  const results = [];

  for (const variant of VARIANTS) {
    process.stdout.write(`  ${variant.id.padEnd(20)} `);
    try {
      const result = await synthesise(variant);
      if (!result.ok) {
        console.log(`FAILED  ${result.detail}`);
        results.push({ id: variant.id, status: "failed", detail: result.detail });
        continue;
      }

      characters += variant.text.length;
      writeFileSync(join(OUT_DIR, `${variant.id}.wav`), result.bytes);
      const kb = (result.bytes.length / 1024).toFixed(0);
      console.log(`ok  ${String(kb).padStart(4)} KB  ${variant.note}`);
      results.push({ id: variant.id, status: "ok" });
    } catch (err) {
      console.log(`ERROR  ${err?.message ?? err}`);
      results.push({ id: variant.id, status: "error", detail: String(err?.message ?? err) });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status !== "ok");

  console.log("\n" + "=".repeat(64));
  console.log(`synthesised ${ok} of ${VARIANTS.length}`);
  console.log(`characters billed: ~${characters}  (about ₹${((characters / 1000) * 3).toFixed(2)})`);

  if (failed.length) {
    console.log("\nfailures:");
    for (const f of failed) console.log(`  ${f.id}: ${f.detail}`);
  }

  console.log("\nLISTEN, in this order:");
  console.log("  1. spike/out/punctuation/a-current-commas.wav   <- today, Azure");
  console.log("  2. spike/out/sarvam/1-shubh-commas.wav          <- same text, Sarvam");
  console.log("     Is Sarvam clearly better on identical text?");
  console.log("");
  console.log("  3. spike/out/punctuation/z-ssml-reference.wav   <- the SSML version you liked");
  console.log("  4. spike/out/sarvam/2-shubh-graded.wav          <- Sarvam, plain text only");
  console.log("     Does Sarvam beat Azure-with-SSML using plain text?");
  console.log("");
  console.log("  5. spike/out/sarvam/4-shubh-MANGLISH.wav        <- the big one");
  console.log("     Is the mixed Malayalam/English intelligible? On Azure it was not.");
  console.log("     If this works, the character can talk the way you wanted.");
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
