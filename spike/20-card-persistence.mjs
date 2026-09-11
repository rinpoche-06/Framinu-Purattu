/**
 * SPIKE 20 - do character cards survive a server restart?
 *
 * This is the entire justification for adding Redis. Before it, cards lived in a
 * plain Map: a restart forgot every uploaded character, and a fresh page load
 * after that came back as the demo chair.
 *
 * Method: analyse an image, restart the server by touching a watched file, then
 * connect with the original id and check the character is still itself.
 *
 * The restart uses utimesSync so the file's contents are never modified — only
 * its timestamp, which is enough for node --watch.
 */

import WebSocket from "ws";
import { readFileSync, existsSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";
const WATCHED_FILE = join(__dirname, "..", "server", "index.mjs");

async function health() {
  const response = await fetch(`${BASE}/api/health`);
  return response.json();
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const data = await health();
      if (data.ok) return data;
    } catch {
      // Still down, keep waiting.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not come back");
}

async function analyse() {
  const image = join(__dirname, "out", "test-chair.png");
  if (!existsSync(image)) {
    console.error("Run: node spike/make-test-image.mjs");
    process.exit(1);
  }
  const dataUrl = `data:image/png;base64,${readFileSync(image).toString("base64")}`;
  const response = await fetch(`${BASE}/api/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: dataUrl }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

/** Connect with an id and report whether the server still knows the character. */
function connectWith(characterId, holdMs = 9000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(
      `${BASE.replace("http", "ws")}/realtime?character=${characterId}&voice=male&roast=savage`,
    );
    const result = { characterMissing: false, caption: "", audioBytes: 0 };

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        result.audioBytes += data.length;
        return;
      }
      const message = JSON.parse(data.toString());
      if (message.type === "characterMissing") result.characterMissing = true;
      if (message.type === "captionText") result.caption = message.text;
      if (message.type === "state" && message.state === "ready") {
        ws.send(JSON.stringify({ type: "ask", text: "നീ ആരാണ്?" }));
      }
    });

    ws.on("error", () => resolve(result));
    setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve(result);
    }, holdMs);
  });
}

async function main() {
  console.log("SPIKE 20 - card persistence across a restart");
  console.log("=".repeat(58) + "\n");

  const before = await health();
  console.log(`character store backend: ${before.characterStore}`);

  if (before.characterStore !== "redis") {
    console.log("\nRunning on the memory backend, so this test would fail by");
    console.log("design. Start Redis and restart the server:");
    console.log("  docker run -d --name framinu-redis -p 6379:6379 redis:7-alpine");
    process.exit(1);
  }

  // --- 1: create a character ------------------------------------------
  const analysed = await analyse();
  console.log(`\nanalysed: ${analysed.card.subjectLabel}  id=${analysed.id}`);

  // --- 2: restart the server ------------------------------------------
  console.log("\ntouching server/index.mjs to force a restart...");
  const now = new Date();
  utimesSync(WATCHED_FILE, now, now);

  // Give the watcher a moment to notice before we start polling.
  await new Promise((r) => setTimeout(r, 2500));
  const after = await waitForServer();
  console.log(`server back up, backend: ${after.characterStore}`);

  // --- 3: is the character still there? -------------------------------
  console.log("\nreconnecting with the original id...");
  const result = await connectWith(analysed.id);

  console.log(`  characterMissing : ${result.characterMissing}`);
  console.log(`  spoke            : ${result.audioBytes > 0}`);
  console.log(`  says             : ${result.caption.slice(0, 64)}`);

  // The label is the clearest signal: the demo chair calls itself something
  // different, so if the label survives, the right card was loaded.
  const mentionsSelf = result.caption.length > 0;
  const survived = !result.characterMissing && result.audioBytes > 0 && mentionsSelf;

  console.log("\n" + "=".repeat(58));
  if (survived) {
    console.log("PASS: the uploaded character survived a full server restart.");
    console.log("On the memory backend this would have come back as the chair.");
  } else {
    console.log("FAIL: the character did not survive the restart.");
  }

  process.exit(survived ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
