/**
 * SPIKE 15 - what does Sarvam actually return, and how fast?
 *
 * Two facts needed before integrating:
 *
 *  1. LATENCY. Today Azure gives first audio in about 1.0-1.3s. If Sarvam adds
 *     much more than that, the conversation stops feeling live and the trade is
 *     not worth it regardless of voice quality.
 *
 *  2. FORMAT. Our browser player expects raw PCM16 at 24 kHz. If Sarvam returns
 *     a WAV, every chunk we forward must have its 44-byte RIFF header stripped,
 *     or the player will decode header bytes as audio and click.
 *
 * Compares the plain REST endpoint against the HTTP streaming endpoint.
 */

import "dotenv/config";

const API_KEY = process.env.SARVAM_API_KEY;
const BASE = "https://api.sarvam.ai";
const MODEL = "bulbul:v3";
const LANGUAGE = "ml-IN";
const SPEAKER = "gokul";

/** Typical reply length: one or two short sentences. */
const LINE =
  "ഛേ! നൂറ്റാണ്ടുകളായി ഞാൻ ഇതേ ഭാവത്തിൽ നിൽക്കുന്നു... ഈ ഫ്രെയിം എന്റെ ജയിലാണ്!";

const headers = {
  "api-subscription-key": API_KEY,
  "Content-Type": "application/json",
};

const payload = {
  text: LINE,
  target_language_code: LANGUAGE,
  model: MODEL,
  speaker: SPEAKER,
  pace: 1.0,
};

function describeBytes(buffer) {
  const head = buffer.subarray(0, 4).toString("ascii");
  if (head === "RIFF") {
    const format = buffer.subarray(8, 12).toString("ascii");
    const sampleRate = buffer.readUInt32LE(24);
    const bits = buffer.readUInt16LE(34);
    const channels = buffer.readUInt16LE(22);
    return `WAV (${format}) ${sampleRate}Hz ${bits}-bit ${channels}ch, 44-byte header must be stripped`;
  }
  const hex = buffer.subarray(0, 8).toString("hex");
  return `not RIFF, first 8 bytes: ${hex} — likely raw PCM, no stripping needed`;
}

async function testRest() {
  console.log("[1] REST  POST /text-to-speech");
  const startedAt = Date.now();

  const response = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  const elapsed = Date.now() - startedAt;

  if (!response.ok) {
    console.log(`    FAILED ${response.status}: ${raw.slice(0, 160)}`);
    return null;
  }

  const parsed = JSON.parse(raw);
  const base64 = Array.isArray(parsed.audios) ? parsed.audios[0] : parsed.audio;
  const bytes = Buffer.from(base64, "base64");

  console.log(`    full response in ${elapsed}ms`);
  console.log(`    ${bytes.length} bytes -> ${describeBytes(bytes)}`);
  console.log(`    audio duration approx ${((bytes.length - 44) / 48000).toFixed(1)}s`);
  console.log(`    NOTE: nothing plays until all ${elapsed}ms have passed`);
  return { firstByteMs: elapsed, totalMs: elapsed };
}

async function testStreaming() {
  console.log("\n[2] STREAMING  POST /text-to-speech/stream");
  const startedAt = Date.now();

  let response;
  try {
    response = await fetch(`${BASE}/text-to-speech/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.log(`    network error: ${err.message}`);
    return null;
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200).replace(/\s+/g, " ");
    console.log(`    FAILED ${response.status}: ${detail}`);
    console.log("    (if 404, this endpoint may not exist on this plan)");
    return null;
  }

  console.log(`    content-type: ${response.headers.get("content-type")}`);

  const reader = response.body.getReader();
  const chunks = [];
  let firstByteMs = null;
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs === null) {
      firstByteMs = Date.now() - startedAt;
      console.log(`    FIRST CHUNK in ${firstByteMs}ms  (${value.length} bytes)`);
      console.log(`    ${describeBytes(Buffer.from(value))}`);
    }
    chunkCount++;
    chunks.push(Buffer.from(value));
  }

  const total = Date.now() - startedAt;
  const bytes = Buffer.concat(chunks);
  console.log(`    ${chunkCount} chunks, ${bytes.length} bytes, complete in ${total}ms`);

  return { firstByteMs, totalMs: total };
}

async function main() {
  if (!API_KEY) {
    console.error("[FAIL] SARVAM_API_KEY is not set in .env");
    process.exit(1);
  }

  console.log("SPIKE 15 - Sarvam latency and format probe");
  console.log(`voice ${SPEAKER}   model ${MODEL}   ${LINE.length} characters\n`);

  const rest = await testRest();
  const streaming = await testStreaming();

  console.log("\n" + "=".repeat(62));
  console.log("TIME TO FIRST AUDIO — the number that decides this");
  console.log("  Azure today (measured earlier) : ~1000-1300ms");
  if (rest) console.log(`  Sarvam REST                    : ${rest.firstByteMs}ms`);
  if (streaming?.firstByteMs != null) {
    console.log(`  Sarvam streaming               : ${streaming.firstByteMs}ms`);
  }

  console.log("\nRemember this is TTS only. The real total adds the time Voice");
  console.log("Live takes to generate the reply text first, so the end-to-end");
  console.log("figure will be higher than whatever is printed above.");

  if (streaming?.firstByteMs != null && rest) {
    const better = streaming.firstByteMs < rest.firstByteMs;
    console.log(
      `\nUse the ${better ? "STREAMING" : "REST"} endpoint: first audio ` +
        `${Math.abs(streaming.firstByteMs - rest.firstByteMs)}ms ` +
        `${better ? "sooner" : "later"} than the alternative.`,
    );
  }
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
