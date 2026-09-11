/**
 * SPIKE 17 - confirm the exact config we will integrate, and time it.
 *
 * Established by spike 16:
 *   POST /text-to-speech/stream
 *   output_audio_codec: "linear16"   -> raw PCM, content-type audio/pcm
 *   speech_sample_rate: 24000        -> matches our player exactly
 *
 * That combination needs no MP3 decoder and no resampling: the bytes go
 * straight through the server to the browser's existing PCM queue.
 *
 * This measures time to first audio across several runs, because a single
 * sample is not a latency measurement.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out", "sarvam-final");

const API_KEY = process.env.SARVAM_API_KEY;
const URL = "https://api.sarvam.ai/text-to-speech/stream";
const SAMPLE_RATE = 24000;

/** The exact request the server will make. */
function buildRequest(text, speaker) {
  return {
    method: "POST",
    headers: {
      "api-subscription-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: "ml-IN",
      model: "bulbul:v3",
      speaker,
      pace: 1.0,
      output_audio_codec: "linear16",
      speech_sample_rate: SAMPLE_RATE,
    }),
  };
}

const LINES = [
  { id: "malayalam", speaker: "gokul", text: "ഛേ! നൂറ്റാണ്ടുകളായി ഇതേ ഭാവത്തിൽ... ഈ ഫ്രെയിം എന്റെ ജയിലാണ്!" },
  { id: "manglish", speaker: "gokul", text: "അയ്യോ, മടുത്തു... എനിക്ക് leave ഇല്ല, back pain ആരും ചോദിക്കില്ല!" },
  { id: "female", speaker: "roopa", text: "ഛേ! നൂറ്റാണ്ടുകളായി ഇതേ ഭാവത്തിൽ... ഈ ഫ്രെയിം എന്റെ ജയിലാണ്!" },
];

/** Minimal WAV wrapper so the raw PCM is playable for a listening check. */
function pcm16ToWav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function run(line) {
  const startedAt = Date.now();
  const response = await fetch(URL, buildRequest(line.text, line.speaker));

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    return { ok: false, detail: `${response.status} ${detail}` };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const reader = response.body.getReader();
  const chunks = [];
  let firstByteMs = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs === null) firstByteMs = Date.now() - startedAt;
    chunks.push(Buffer.from(value));
  }

  const pcm = Buffer.concat(chunks);
  const isRaw = pcm.subarray(0, 4).toString("ascii") !== "RIFF";

  return {
    ok: true,
    contentType,
    firstByteMs,
    totalMs: Date.now() - startedAt,
    bytes: pcm.length,
    seconds: pcm.length / (SAMPLE_RATE * 2),
    isRaw,
    chunks: chunks.length,
    pcm,
  };
}

async function main() {
  if (!API_KEY) {
    console.error("[FAIL] SARVAM_API_KEY is not set in .env");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log("SPIKE 17 - final config confirmation");
  console.log("  POST /text-to-speech/stream");
  console.log("  output_audio_codec=linear16  speech_sample_rate=24000\n");

  const firstBytes = [];

  for (const line of LINES) {
    process.stdout.write(`  ${line.id.padEnd(11)} `);
    const result = await run(line);

    if (!result.ok) {
      console.log(`FAILED  ${result.detail}`);
      continue;
    }

    firstBytes.push(result.firstByteMs);
    writeFileSync(join(OUT_DIR, `${line.id}.wav`), pcm16ToWav(result.pcm));

    console.log(
      `first ${String(result.firstByteMs).padStart(4)}ms  ` +
        `total ${String(result.totalMs).padStart(4)}ms  ` +
        `${result.seconds.toFixed(1)}s audio  ` +
        `${result.chunks} chunks  ` +
        `${result.isRaw ? "raw PCM" : "HAS RIFF HEADER"}`,
    );
  }

  const average = firstBytes.reduce((a, b) => a + b, 0) / (firstBytes.length || 1);

  console.log("\n" + "=".repeat(64));
  console.log(`average time to first audio: ${Math.round(average)}ms`);
  console.log("Azure today, measured earlier: 1000-1300ms\n");

  if (average < 900) {
    console.log("VERDICT: fast enough. TTS latency is not a reason to avoid this.");
    console.log("The end-to-end figure still adds Voice Live's text generation on");
    console.log("top, so it must be measured again after integration.");
  } else {
    console.log("VERDICT: slower than hoped. Weigh against the voice quality gain.");
  }

  console.log("\nAlso listen to spike/out/sarvam-final/*.wav to confirm the audio");
  console.log("is intact — a sample-rate mistake sounds like the wrong pitch, not");
  console.log("like an error.");
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
