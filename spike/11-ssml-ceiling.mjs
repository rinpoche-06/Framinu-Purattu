/**
 * SPIKE 11 - how good can ml-IN-MidhunNeural actually sound?
 *
 * READ THIS FIRST: this script changes nothing. It only writes wav files into
 * spike/out/ssml/. The app, the server and the current voice configuration are
 * untouched. If we do not like the results, there is nothing to undo.
 *
 * Why it exists: Voice Live exposes only whole-utterance `rate`, `pitch` and
 * `volume` for the voice, and the SDK has no SSML input path. So we have never
 * heard what this voice can do with per-word stress, comic pauses or pitch
 * contours.
 *
 * This calls the Azure Speech TTS REST API directly, where SSML IS allowed, to
 * find the ceiling of the voice itself.
 *
 * What a result means:
 *   - barely different  -> the flat delivery is the voice's real limit. We stop
 *                          wondering, keep the current architecture, and move on.
 *   - clearly better    -> the voice can do more, and it becomes an argument for
 *                          restructuring the audio path AFTER the hackathon.
 *
 * Either way nothing changes today.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out", "ssml");

const API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
// The resource lives in eastus2 (confirmed in the portal and via DNS).
const REGION = process.env.AZURE_SPEECH_REGION ?? "eastus2";
const TTS_URL = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

const MALE = "ml-IN-MidhunNeural";
const FEMALE = "ml-IN-SobhanaNeural";

/** A line the chair actually produced, so we judge comedy not neutral prose. */
const PLAIN_LINE =
  "അയ്യോ, എന്തെങ്കിലും പറയൂ, ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല, ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!";

const escapeXml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ssml(voice, inner) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ml-IN"><voice name="${voice}">${inner}</voice></speak>`;
}

/**
 * Variants, ordered so the listening comparison is meaningful.
 * 1 is the control: what Voice Live gives us today.
 */
const VARIANTS = [
  {
    id: "1-control-plain",
    note: "exactly what we ship today",
    voice: MALE,
    inner: escapeXml(PLAIN_LINE),
  },
  {
    id: "2-global-prosody",
    note: "whole-utterance rate/pitch, the only lever Voice Live exposes",
    voice: MALE,
    inner: `<prosody rate="0.95" pitch="-2%">${escapeXml(PLAIN_LINE)}</prosody>`,
  },
  {
    id: "3-comic-pauses",
    note: "breaks for timing, which we cannot currently do",
    voice: MALE,
    inner:
      `അയ്യോ<break time="450ms"/> എന്തെങ്കിലും പറയൂ<break time="350ms"/> ` +
      `ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല<break time="250ms"/> ` +
      `ഫോട്ടോയുടെ ചുറ്റളം എന്റെ ദേശം!`,
  },
  {
    id: "4-word-stress",
    note: "per-word pitch stress, the closest thing to emphasis",
    voice: MALE,
    inner:
      `<prosody pitch="+18%" rate="0.9">അയ്യോ</prosody>, എന്തെങ്കിലും പറയൂ, ` +
      `ഞാൻ <prosody pitch="+12%">കസേര പ്രവചന യന്ത്രമല്ല</prosody>, ` +
      `ഫോട്ടോയുടെ ചുറ്റളം <prosody pitch="+15%" rate="0.88">എന്റെ ദേശം</prosody>!`,
  },
  {
    id: "5-emphasis-tag",
    note: "the <emphasis> element, which Standard-tier voices may ignore",
    voice: MALE,
    inner:
      `<emphasis level="strong">അയ്യോ</emphasis>, എന്തെങ്കിലും പറയൂ, ` +
      `ഞാൻ കസേര പ്രവചന യന്ത്രമല്ല, ` +
      `ഫോട്ടോയുടെ ചുറ്റളം <emphasis level="moderate">എന്റെ ദേശം</emphasis>!`,
  },
  {
    id: "6-pitch-contour",
    note: "a rising-then-falling contour across the sentence",
    voice: MALE,
    inner: `<prosody contour="(0%,+8%) (35%,+22%) (75%,-5%) (100%,-14%)">${escapeXml(PLAIN_LINE)}</prosody>`,
  },
  {
    id: "7-everything-male",
    note: "pauses + stress + contour together, the realistic best case",
    voice: MALE,
    inner:
      `<prosody contour="(0%,+10%) (50%,+18%) (100%,-12%)">` +
      `<prosody pitch="+20%" rate="0.88">അയ്യോ</prosody><break time="420ms"/> ` +
      `എന്തെങ്കിലും പറയൂ<break time="320ms"/> ` +
      `ഞാൻ <prosody pitch="+14%">കസേര പ്രവചന യന്ത്രമല്ല</prosody><break time="220ms"/> ` +
      `ഫോട്ടോയുടെ ചുറ്റളം <prosody pitch="+16%" rate="0.9">എന്റെ ദേശം</prosody>!` +
      `</prosody>`,
  },
  {
    id: "8-everything-female",
    note: "the same treatment on Sobhana",
    voice: FEMALE,
    inner:
      `<prosody contour="(0%,+10%) (50%,+18%) (100%,-12%)">` +
      `<prosody pitch="+20%" rate="0.88">അയ്യോ</prosody><break time="420ms"/> ` +
      `എന്തെങ്കിലും പറയൂ<break time="320ms"/> ` +
      `ഞാൻ <prosody pitch="+14%">കസേര പ്രവചന യന്ത്രമല്ല</prosody><break time="220ms"/> ` +
      `ഫോട്ടോയുടെ ചുറ്റളം <prosody pitch="+16%" rate="0.9">എന്റെ ദേശം</prosody>!` +
      `</prosody>`,
  },
];

async function synthesise(variant) {
  const body = ssml(variant.voice, variant.inner);

  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": API_KEY,
      "Content-Type": "application/ssml+xml",
      // RIFF output means the response is already a playable wav file.
      "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
      "User-Agent": "framinu-purathu-spike",
    },
    body,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200).replace(/\s+/g, " ");
    return { ok: false, detail: `${response.status} ${detail}` };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return { ok: true, bytes };
}

async function main() {
  if (!API_KEY) {
    console.error("[FAIL] AZURE_VOICELIVE_API_KEY is not set in .env");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("SPIKE 11 - SSML ceiling test for Malayalam voices");
  console.log("Nothing in the app is modified. Output: spike/out/ssml/\n");
  console.log(`region ${REGION}\n`);

  const results = [];

  for (const variant of VARIANTS) {
    process.stdout.write(`  ${variant.id.padEnd(22)} `);
    try {
      const result = await synthesise(variant);
      if (!result.ok) {
        console.log(`FAILED  ${result.detail}`);
        results.push({ ...variant, status: "failed", detail: result.detail });
        continue;
      }

      // 44-byte RIFF header, then 48 bytes per millisecond of 24 kHz mono PCM.
      const seconds = ((result.bytes.length - 44) / 48000).toFixed(1);
      writeFileSync(join(OUT_DIR, `${variant.id}.wav`), result.bytes);
      console.log(`ok  ${String(seconds).padStart(5)}s  ${variant.note}`);
      results.push({ ...variant, status: "ok", seconds: Number(seconds) });
    } catch (err) {
      console.log(`ERROR  ${err?.message ?? err}`);
      results.push({ ...variant, status: "error", detail: String(err?.message ?? err) });
    }
  }

  const ok = results.filter((r) => r.status === "ok");
  const control = ok.find((r) => r.id === "1-control-plain");
  const best = ok.find((r) => r.id === "7-everything-male");

  console.log("\n" + "=".repeat(62));
  console.log(`synthesised ${ok.length} of ${VARIANTS.length}`);

  if (control && best) {
    const delta = (best.seconds - control.seconds).toFixed(1);
    console.log(`control ${control.seconds}s vs full SSML ${best.seconds}s (${delta}s of added pauses)`);
  }

  const failed = results.filter((r) => r.status !== "ok");
  if (failed.length) {
    console.log("\nunsupported for these voices:");
    for (const f of failed) console.log(`  ${f.id}: ${f.detail}`);
  }

  console.log("\nLISTEN in this order:");
  console.log("  1-control-plain     <- today's sound");
  console.log("  3-comic-pauses      <- does timing alone help?");
  console.log("  4-word-stress       <- does stressing words help?");
  console.log("  7-everything-male   <- realistic best case");
  console.log("\nThe question is narrow: is 7 meaningfully funnier than 1?");
  console.log("If no, the ceiling is real and we keep what we have.");
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
