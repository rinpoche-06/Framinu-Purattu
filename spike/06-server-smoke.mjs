/**
 * SPIKE 06 - server smoke test.
 *
 * Connects to our own backend the same way the browser does, triggers the
 * greeting and the escape interaction, and checks that audio comes back as
 * binary frames. Verifies the whole server chain without needing a microphone.
 *
 * Run the dev server first, then: node spike/06-server-smoke.mjs
 */

import WebSocket from "ws";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");
const SAMPLE_RATE = 24000;
const URL = process.env.SMOKE_URL ?? "ws://localhost:8787/realtime";

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

mkdirSync(OUT_DIR, { recursive: true });

const chunks = [];
const states = [];
const captions = [];
let errors = [];
let firstAudioAt = 0;
let greetSentAt = 0;

const ws = new WebSocket(URL);

ws.on("open", () => console.log(`connected to ${URL}`));

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    if (!firstAudioAt) {
      firstAudioAt = Date.now();
      console.log(`  first audio frame after ${firstAudioAt - greetSentAt}ms`);
    }
    chunks.push(Buffer.from(data));
    return;
  }

  const message = JSON.parse(data.toString());
  switch (message.type) {
    case "state":
      states.push(message.state);
      console.log(`  state: ${message.state}`);
      if (message.state === "ready" && !greetSentAt) {
        greetSentAt = Date.now();
        console.log("  -> sending greet");
        ws.send(JSON.stringify({ type: "greet" }));
      }
      break;
    case "captionText":
      captions.push(message.text);
      console.log(`  caption: ${message.text}`);
      break;
    case "error":
      errors.push(message.message);
      console.log(`  ERROR: ${message.message}`);
      break;
    default:
      console.log(`  ${message.type}`);
  }
});

ws.on("error", (err) => {
  console.error("socket error:", err.message);
  process.exit(1);
});

// Give the greeting time to finish, then try the escape interaction.
setTimeout(() => {
  if (ws.readyState === WebSocket.OPEN) {
    console.log("  -> sending escape");
    ws.send(JSON.stringify({ type: "escape" }));
  }
}, 14000);

setTimeout(() => {
  const pcm = Buffer.concat(chunks);
  const seconds = (pcm.length / (SAMPLE_RATE * 2)).toFixed(1);

  console.log("\n" + "=".repeat(52));
  console.log(`audio received : ${pcm.length} bytes (${seconds}s)`);
  console.log(`states seen    : ${states.join(" -> ")}`);
  console.log(`captions       : ${captions.length}`);
  console.log(`errors         : ${errors.length ? errors.join("; ") : "none"}`);

  if (pcm.length > 0) {
    const file = join(OUT_DIR, "server-smoke.wav");
    writeFileSync(file, pcm16ToWav(pcm));
    console.log(`\nsaved ${file}`);
    console.log("PASS: server relays realtime audio to a browser-style client.");
  } else {
    console.log("\nFAIL: no audio came through the server.");
  }

  ws.close();
  process.exit(pcm.length > 0 ? 0 : 1);
}, 26000);
