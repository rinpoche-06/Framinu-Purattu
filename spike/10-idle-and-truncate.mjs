/**
 * SPIKE 10 - idle prodding and interruption truncation.
 *
 * Two behaviours that are hard to eyeball in a browser:
 *
 *  1. IDLE PRODDING. Connect, greet, then deliberately say nothing. The
 *     character should speak unprompted after 10s, escalate, and stop after
 *     three attempts rather than nagging forever.
 *
 *  2. TRUNCATION. Ask a question, let a little audio play, then report a small
 *     "played" duration as the browser would on barge-in. The service must
 *     accept the truncate event. It errors if asked to truncate past the real
 *     audio duration, so a silent pass here means the clamping is right.
 */

import WebSocket from "ws";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";
const WS_URL = `${BASE.replace("http", "ws")}/realtime`;

function connect() {
  const ws = new WebSocket(WS_URL);
  ws.setMaxListeners(0);
  return ws;
}

/** Part 1: stay silent and count unprompted lines. */
async function testIdleProdding() {
  console.log("[1] idle prodding — staying silent for 45s");
  console.log("    expecting a greeting, then up to 3 prods, then quiet\n");

  const events = [];
  const startedAt = Date.now();

  await new Promise((resolve) => {
    const ws = connect();
    let latestCaption = "";

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString());

      if (message.type === "state" && message.state === "ready") {
        ws.send(JSON.stringify({ type: "greet" }));
      }

      // Count REPLIES, not caption messages. On the Sarvam path captions grow
      // sentence by sentence, so several arrive per reply and counting them
      // would badly overstate how often the character spoke.
      if (message.type === "responseStart") {
        const at = Number(((Date.now() - startedAt) / 1000).toFixed(1));
        events.push({ at, text: "" });
        latestCaption = "";
      }
      if (message.type === "captionText") {
        latestCaption = message.text;
        if (events.length) events[events.length - 1].text = latestCaption;
      }
      if (message.type === "error") console.log(`    [error] ${message.message}`);
    });

    ws.on("error", (err) => {
      console.log(`    socket error: ${err.message}`);
      resolve();
    });

    setTimeout(() => {
      ws.close();
      resolve();
    }, 45000);
  });

  for (const event of events) {
    console.log(`    +${event.at}s  ${event.text || "(no caption)"}`);
  }

  const prods = Math.max(0, events.length - 1);
  console.log(`\n    replies total: ${events.length} (1 greeting + ${prods} prods)`);

  const gaps = events.slice(1).map((event, index) => event.at - events[index].at);
  if (gaps.length) {
    console.log(`    gaps between lines: ${gaps.map((g) => g.toFixed(1) + "s").join(", ")}`);
  }

  const ok = prods >= 2 && prods <= 3;
  console.log(
    ok
      ? "    PASS: it prods when ignored, and stops instead of nagging forever."
      : `    CHECK: expected 2-3 prods in 45s, saw ${prods}.`,
  );
  return ok;
}

/** Part 2: interrupt mid-reply and truncate to what was "heard". */
async function testTruncation() {
  const health = await (await fetch(BASE + "/api/health")).json().catch(() => ({}));
  if (health.ttsProvider === "sarvam") {
    console.log("\n[2] truncation — SKIPPED on the sarvam path");
    console.log("    Voice Live produces no audio item in text-only mode, so");
    console.log("    there is nothing to truncate. Barge-in instead aborts the");
    console.log("    Sarvam stream. Known tradeoff, recorded in the README.");
    return true;
  }

  console.log("\n[2] truncation — cutting a reply short after ~1s of audio\n");

  let itemId = null;
  let audioBytes = 0;
  let truncateSent = false;
  const errors = [];

  await new Promise((resolve) => {
    const ws = connect();
    let firstAudioAt = 0;

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        audioBytes += data.length;
        if (!firstAudioAt) firstAudioAt = Date.now();

        // Once a bit of audio has arrived, pretend the user cut in after
        // roughly one second of it and report that as heard.
        if (!truncateSent && itemId && Date.now() - firstAudioAt > 1200) {
          truncateSent = true;
          const heardMs = 1000;
          console.log(`    reporting ${heardMs}ms heard of ${Math.floor(audioBytes / 48)}ms received`);
          ws.send(JSON.stringify({ type: "played", itemId, ms: heardMs }));

          // Then ask a follow-up: if truncation broke the session we will see it.
          setTimeout(() => {
            ws.send(JSON.stringify({ type: "ask", text: "അപ്പോൾ നീ എന്താ പറഞ്ഞത്?" }));
          }, 600);
        }
        return;
      }

      const message = JSON.parse(data.toString());

      if (message.type === "state" && message.state === "ready") {
        ws.send(JSON.stringify({ type: "ask", text: "നിന്റെ കഥ വിശദമായി പറയാമോ?" }));
      }
      if (message.type === "responseStart") {
        itemId = message.itemId;
        console.log(`    responseStart itemId=${message.itemId}`);
      }
      if (message.type === "captionText") {
        console.log(`    says: ${message.text}`);
      }
      if (message.type === "error") {
        errors.push(message.message);
        console.log(`    [error] ${message.message}`);
      }
    });

    ws.on("error", (err) => {
      errors.push(err.message);
      resolve();
    });

    setTimeout(() => {
      ws.close();
      resolve();
    }, 30000);
  });

  console.log(`\n    itemId received : ${itemId ? "yes" : "NO"}`);
  console.log(`    truncate sent   : ${truncateSent ? "yes" : "NO"}`);
  console.log(`    errors          : ${errors.length ? errors.join("; ") : "none"}`);

  // A truncate beyond the real duration would come back as a server error, so
  // "no errors" is the meaningful signal here.
  const ok = Boolean(itemId) && truncateSent && errors.length === 0;
  console.log(
    ok
      ? "    PASS: the service accepted the truncation and kept talking."
      : "    CHECK: truncation did not complete cleanly.",
  );
  return ok;
}

async function main() {
  console.log("SPIKE 10 - idle prodding and truncation");
  console.log("=".repeat(58) + "\n");

  const idleOk = await testIdleProdding();
  const truncateOk = await testTruncation();

  console.log("\n" + "=".repeat(58));
  console.log(`idle prodding : ${idleOk ? "pass" : "check"}`);
  console.log(`truncation    : ${truncateOk ? "pass" : "check"}`);
  process.exit(idleOk && truncateOk ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
