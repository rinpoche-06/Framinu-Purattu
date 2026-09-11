/**
 * SPIKE 19 - reconnection and character restore.
 *
 * Two failures this covers, both of which would ruin a live demo:
 *
 *  1. A dropped socket previously ended the session with no recovery. A DNS
 *     blip did exactly this during development, so it is not hypothetical.
 *
 *  2. Character cards live in server memory. A restart forgot them and the
 *     session silently continued as the demo chair — not an error, just quietly
 *     the wrong character, which is the worst kind of failure.
 *
 * The browser owns the retry loop, so this exercises the SERVER side of it: that
 * a fresh connection works after an abrupt drop, that the server reports a
 * forgotten character rather than substituting one, and that a restored card
 * produces the same character again.
 */

import WebSocket from "ws";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";
const WS_BASE = BASE.replace("http", "ws");

/** Connect, optionally with a character, and report what happened. */
function session({ characterId, onReady, holdMs = 6000 }) {
  return new Promise((resolve) => {
    const url = characterId
      ? `${WS_BASE}/realtime?character=${characterId}&voice=male&roast=savage`
      : `${WS_BASE}/realtime?voice=male&roast=savage`;

    const ws = new WebSocket(url);
    const result = { ready: false, characterMissing: false, audioBytes: 0, caption: "", errors: [] };

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        result.audioBytes += data.length;
        return;
      }
      const message = JSON.parse(data.toString());
      if (message.type === "characterMissing") result.characterMissing = true;
      if (message.type === "captionText") result.caption = message.text;
      if (message.type === "error") result.errors.push(message.message);
      if (message.type === "state" && message.state === "ready" && !result.ready) {
        result.ready = true;
        onReady?.(ws);
      }
    });

    ws.on("error", (err) => result.errors.push(err.message));

    setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve(result);
    }, holdMs);
  });
}

async function analyseTestImage() {
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

async function main() {
  console.log("SPIKE 19 - reconnection and character restore");
  console.log("=".repeat(60) + "\n");

  // --- 1: an abrupt drop, then a fresh connection ----------------------
  console.log("[1] abrupt socket destroy, then reconnect");

  const first = await session({
    holdMs: 5000,
    onReady: (ws) => {
      ws.send(JSON.stringify({ type: "ask", text: "നിനക്ക് മടുത്തില്ലേ?" }));
      // Destroy rather than close: no closing handshake, like a network drop.
      setTimeout(() => ws.terminate(), 2500);
    },
  });
  console.log(`    first session: ready=${first.ready} audio=${first.audioBytes > 0}`);

  const second = await session({
    holdMs: 8000,
    onReady: (ws) => ws.send(JSON.stringify({ type: "ask", text: "വീണ്ടും കേൾക്കാമോ?" })),
  });
  console.log(`    after drop   : ready=${second.ready} audio=${second.audioBytes > 0}`);
  console.log(`    says: ${second.caption.slice(0, 60)}`);

  const reconnectOk = second.ready && second.audioBytes > 0;
  console.log(
    reconnectOk
      ? "    PASS: a new connection works after an abrupt drop.\n"
      : "    FAIL: could not talk after the drop.\n",
  );

  // --- 2: forgotten character is reported, not substituted -------------
  console.log("[2] unknown character id");
  const bogus = await session({ characterId: "c_does_not_exist", holdMs: 5000 });
  console.log(`    characterMissing reported: ${bogus.characterMissing}`);
  console.log(
    bogus.characterMissing
      ? "    PASS: the server says so instead of silently using the chair.\n"
      : "    FAIL: the wrong character would be used with no warning.\n",
  );

  // --- 3: restore a real card and use it -------------------------------
  console.log("[3] analyse, then restore the card under a new id");
  const analysed = await analyseTestImage();
  console.log(`    analysed as: ${analysed.card.subjectLabel} (${analysed.id})`);

  const restore = await fetch(`${BASE}/api/character/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card: analysed.card }),
  });
  const restored = await restore.json();

  if (!restore.ok) {
    console.log(`    FAIL: restore returned ${restore.status}: ${restored.error}`);
    process.exit(1);
  }

  console.log(`    restored as: ${restored.card.subjectLabel} (${restored.id})`);
  const labelMatches = restored.card.subjectLabel === analysed.card.subjectLabel;
  const grievanceMatches = restored.card.grievance === analysed.card.grievance;
  console.log(`    label preserved    : ${labelMatches}`);
  console.log(`    grievance preserved: ${grievanceMatches}`);
  console.log(`    mouth preserved    : ${JSON.stringify(restored.card.mouth) === JSON.stringify(analysed.card.mouth)}`);

  const usable = await session({
    characterId: restored.id,
    holdMs: 9000,
    onReady: (ws) => ws.send(JSON.stringify({ type: "ask", text: "നീ ആരാണ്?" })),
  });
  console.log(`    restored character speaks: ${usable.audioBytes > 0}`);
  console.log(`    missing flag NOT set     : ${!usable.characterMissing}`);
  console.log(`    says: ${usable.caption.slice(0, 60)}`);

  const restoreOk =
    labelMatches && grievanceMatches && usable.audioBytes > 0 && !usable.characterMissing;
  console.log(
    restoreOk
      ? "    PASS: a forgotten character can be recovered intact.\n"
      : "    FAIL: restore did not produce a working character.\n",
  );

  console.log("=".repeat(60));
  console.log(`reconnect after drop : ${reconnectOk ? "pass" : "fail"}`);
  console.log(`missing reported     : ${bogus.characterMissing ? "pass" : "fail"}`);
  console.log(`card restore         : ${restoreOk ? "pass" : "fail"}`);
  console.log("\nNote: the retry loop and backoff live in the browser. Test that");
  console.log("by stopping the dev server mid-conversation and restarting it.");

  process.exit(reconnectOk && bogus.characterMissing && restoreOk ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
