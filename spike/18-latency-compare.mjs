/**
 * SPIKE 18 - honest latency comparison between the two TTS paths.
 *
 * Earlier numbers were not comparable. The 1000-1300ms figure I kept quoting for
 * Azure came from spike 01, which sent a direct text question. The Sarvam numbers
 * came from the greeting flow, which costs an extra round trip on either path. So
 * Sarvam looked worse partly for the wrong reason.
 *
 * This measures the same thing on both: a normal conversational turn, from
 * sending a question to the first byte of audio arriving.
 *
 * Usage:
 *   1. set TTS_PROVIDER in .env, restart the dev server
 *   2. node spike/18-latency-compare.mjs
 *   3. repeat for the other provider
 *
 * The script records results into spike/out/latency.json so the two runs can be
 * compared even though they need separate server restarts.
 */

import WebSocket from "ws";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");
const RESULTS = join(OUT_DIR, "latency.json");
const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";

const QUESTIONS = [
  "നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ?",
  "എന്നെക്കുറിച്ച് നിന്റെ അഭിപ്രായം എന്താ?",
  "ഫ്രെയിമിന് പുറത്ത് പോയാൽ എന്ത് ചെയ്യും?",
];

async function measureTurn(ws, question) {
  return new Promise((resolve) => {
    const askedAt = Date.now();
    let firstAudioMs = null;
    let caption = null;
    let settled = false;

    const onMessage = (data, isBinary) => {
      if (isBinary) {
        if (firstAudioMs === null) firstAudioMs = Date.now() - askedAt;
        return;
      }
      const message = JSON.parse(data.toString());
      if (message.type === "captionText") caption = message.text;
      // "idle" marks the end of the turn on both paths.
      if (message.type === "state" && message.state === "idle" && !settled) {
        settled = true;
        ws.off("message", onMessage);
        resolve({ firstAudioMs, totalMs: Date.now() - askedAt, caption });
      }
    };

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "ask", text: question }));

    setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.off("message", onMessage);
        resolve({ firstAudioMs, totalMs: Date.now() - askedAt, caption, timedOut: true });
      }
    }, 25000);
  });
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const provider = health.ttsProvider ?? "unknown";
  const voices = Object.values(health.voices ?? {}).join(" / ");

  console.log("SPIKE 18 - latency of one conversational turn");
  console.log(`provider: ${provider}   voices: ${voices}\n`);

  const turns = [];

  await new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/realtime`);

    ws.once("message", async function waitReady(data, isBinary) {
      if (isBinary) return ws.once("message", waitReady);
      const message = JSON.parse(data.toString());
      if (message.type !== "state" || message.state !== "ready") {
        return ws.once("message", waitReady);
      }

      for (const question of QUESTIONS) {
        const result = await measureTurn(ws, question);
        turns.push(result);
        console.log(
          `  first audio ${String(result.firstAudioMs ?? "none").padStart(5)}ms   ` +
            `turn ${String(result.totalMs).padStart(5)}ms   ` +
            `${(result.caption ?? "").slice(0, 46)}`,
        );
        // Let the turn settle so measurements do not overlap.
        await new Promise((r) => setTimeout(r, 800));
      }

      ws.close();
      resolve();
    });

    ws.on("error", (err) => {
      console.error("socket error:", err.message);
      resolve();
    });
  });

  const valid = turns.filter((t) => typeof t.firstAudioMs === "number");
  const average = valid.length
    ? Math.round(valid.reduce((sum, t) => sum + t.firstAudioMs, 0) / valid.length)
    : null;

  console.log("\n" + "=".repeat(58));
  console.log(`${provider}: average first audio ${average ?? "n/a"}ms over ${valid.length} turns`);

  mkdirSync(OUT_DIR, { recursive: true });
  const stored = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : {};
  stored[provider] = {
    average,
    samples: valid.map((t) => t.firstAudioMs),
    voices,
    measuredAt: new Date().toISOString(),
  };
  writeFileSync(RESULTS, JSON.stringify(stored, null, 2));

  const providers = Object.keys(stored);
  if (providers.length > 1) {
    console.log("\nBOTH PATHS MEASURED");
    for (const [name, data] of Object.entries(stored)) {
      console.log(`  ${name.padEnd(8)} ${String(data.average).padStart(5)}ms   [${data.samples.join(", ")}]   ${data.voices}`);
    }
    const [a, b] = providers;
    const delta = stored[a].average - stored[b].average;
    console.log(
      `\n  ${delta > 0 ? b : a} is ${Math.abs(delta)}ms faster to first audio.`,
    );
  } else {
    console.log(`\nNow switch TTS_PROVIDER in .env, restart the server, and rerun`);
    console.log("to get the comparison.");
  }
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
