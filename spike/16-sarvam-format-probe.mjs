/**
 * SPIKE 16 - can Sarvam stream raw PCM instead of MP3?
 *
 * Spike 15 found:
 *   - /text-to-speech        -> WAV, but at 22050 Hz, and only after 1831ms
 *   - /text-to-speech/stream -> MP3 (audio/mpeg), first chunk in 511ms
 *
 * Our browser player consumes raw PCM16 at 24 kHz. So:
 *   - the sample rate must be forced to 24000, and
 *   - ideally streaming gives us PCM, avoiding an MP3 decoder in the browser
 *
 * This probes candidate parameter names against both endpoints and reports
 * which the API actually accepts. Guessing in the integration code would mean
 * debugging audio corruption later; better to establish the contract now.
 */

import "dotenv/config";

const API_KEY = process.env.SARVAM_API_KEY;
const BASE = "https://api.sarvam.ai";

const CORE = {
  text: "ഛേ! ഈ ഫ്രെയിം എന്റെ ജയിലാണ്!",
  target_language_code: "ml-IN",
  model: "bulbul:v3",
  speaker: "gokul",
};

const headers = {
  "api-subscription-key": API_KEY,
  "Content-Type": "application/json",
};

/** Names to try. Only one of these is likely real. */
const CANDIDATES = [
  { label: "speech_sample_rate 24000", extra: { speech_sample_rate: 24000 } },
  { label: "output_audio_codec wav", extra: { output_audio_codec: "wav" } },
  { label: "output_audio_codec pcm", extra: { output_audio_codec: "pcm" } },
  { label: "output_audio_codec linear16", extra: { output_audio_codec: "linear16" } },
  { label: "encoding linear16", extra: { encoding: "linear16" } },
  { label: "audio_format wav", extra: { audio_format: "wav" } },
  { label: "output_format wav", extra: { output_format: "wav" } },
];

function describe(buffer, contentType) {
  const head = buffer.subarray(0, 4).toString("ascii");
  if (head === "RIFF") {
    return `WAV ${buffer.readUInt32LE(24)}Hz ${buffer.readUInt16LE(34)}-bit`;
  }
  const b0 = buffer[0];
  const b1 = buffer[1];
  // MP3 frames begin with 11 set sync bits.
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return "MP3 frame";
  return `unknown (${contentType ?? "?"}) ${buffer.subarray(0, 6).toString("hex")}`;
}

async function probe(path, extra, label) {
  process.stdout.write(`  ${label.padEnd(30)} `);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...CORE, ...extra }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 110).replace(/\s+/g, " ");
      console.log(`rejected ${response.status}  ${detail}`);
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());

    // JSON responses carry base64 audio; binary ones are the audio itself.
    if (contentType.includes("json")) {
      const parsed = JSON.parse(buffer.toString());
      const base64 = Array.isArray(parsed.audios) ? parsed.audios[0] : parsed.audio;
      if (!base64) {
        console.log(`accepted, but no audio. keys: ${Object.keys(parsed).join(",")}`);
        return null;
      }
      const audio = Buffer.from(base64, "base64");
      const info = describe(audio, contentType);
      console.log(`accepted -> ${info}`);
      return { label, info };
    }

    const info = describe(buffer, contentType);
    console.log(`accepted -> ${info}`);
    return { label, info };
  } catch (err) {
    console.log(`error ${err.message}`);
    return null;
  }
}

async function main() {
  if (!API_KEY) {
    console.error("[FAIL] SARVAM_API_KEY is not set in .env");
    process.exit(1);
  }

  console.log("SPIKE 16 - output format probe\n");

  console.log("REST  /text-to-speech");
  console.log("  (baseline with no extra params was WAV 22050Hz)");
  const restResults = [];
  for (const candidate of CANDIDATES) {
    const result = await probe("/text-to-speech", candidate.extra, candidate.label);
    if (result) restResults.push(result);
  }

  console.log("\nSTREAM  /text-to-speech/stream");
  console.log("  (baseline with no extra params was MP3)");
  const streamResults = [];
  for (const candidate of CANDIDATES) {
    const result = await probe("/text-to-speech/stream", candidate.extra, candidate.label);
    if (result) streamResults.push(result);
  }

  console.log("\n" + "=".repeat(64));
  console.log("WHAT WE NEED: 24000 Hz, PCM16, ideally streamed\n");

  const wav24 = [...restResults, ...streamResults].filter((r) => r.info.includes("24000"));
  const streamPcm = streamResults.filter((r) => !r.info.includes("MP3"));

  console.log(`params giving 24000 Hz : ${wav24.length ? wav24.map((r) => r.label).join(", ") : "NONE FOUND"}`);
  console.log(`streaming without MP3  : ${streamPcm.length ? streamPcm.map((r) => r.label).join(", ") : "NONE — MP3 only"}`);

  console.log("\nIf streaming is MP3-only, the browser needs to decode it, which");
  console.log("means either buffering the whole clip before playback or feeding an");
  console.log("audio element through MediaSource. Both are more work than the");
  console.log("current raw-PCM path, and that cost belongs in the decision.");
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
