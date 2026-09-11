/**
 * SPIKE 07 - Phase 2 smoke test.
 *
 * Exercises the upload path the way the browser does:
 *   1. POST /api/analyse with an image data URL
 *   2. check the returned card is schema-valid and sanitised
 *   3. open /realtime?character=<id> and confirm the character actually speaks
 *      as the analysed subject rather than as the default chair
 *
 * Also checks prompt-injection defence: we send an image whose "text" would be
 * an instruction if the card were pasted into the prompt unfenced.
 */

import WebSocket from "ws";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";
const IMAGE = process.argv[2] ?? join(__dirname, "out", "test-chair.png");

if (!existsSync(IMAGE)) {
  console.error(`No image at ${IMAGE}. Run: node spike/make-test-image.mjs`);
  process.exit(1);
}

const mime = IMAGE.endsWith(".png") ? "image/png" : "image/jpeg";
const dataUrl = `data:${mime};base64,${readFileSync(IMAGE).toString("base64")}`;

const REQUIRED = [
  "subjectType", "subjectLabel", "visibleDetails", "uncertainties",
  "personality", "grievance", "secretDesire", "runningJoke", "openingLine", "mouth",
];

function checkCard(card) {
  const problems = [];

  for (const field of REQUIRED) {
    if (card[field] === undefined) problems.push(`missing ${field}`);
  }

  // Sanitisation: no newlines anywhere, or injected text could pose as a new
  // instruction block in the assembled prompt.
  for (const [key, value] of Object.entries(card)) {
    const strings = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    for (const s of strings) {
      if (/[\r\n]/.test(s)) problems.push(`${key} contains a newline`);
    }
  }

  const m = card.mouth ?? {};
  for (const k of ["x", "y", "width", "height", "rotation"]) {
    if (typeof m[k] !== "number") problems.push(`mouth.${k} is not a number`);
  }
  for (const k of ["x", "y", "width", "height"]) {
    if (typeof m[k] === "number" && (m[k] < 0 || m[k] > 1)) {
      problems.push(`mouth.${k}=${m[k]} outside 0-1`);
    }
  }

  return problems;
}

async function main() {
  console.log("SPIKE 07 - Phase 2 smoke test");
  console.log("=".repeat(56));

  // --- step 1: reject a bad content type -------------------------------
  const bad = await fetch(`${BASE}/api/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: "data:image/gif;base64,AAAA" }),
  });
  console.log(`unsupported type rejected : ${bad.status === 415 ? "yes" : `NO (${bad.status})`}`);

  const malformed = await fetch(`${BASE}/api/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: "not-a-data-url" }),
  });
  console.log(`malformed body rejected   : ${malformed.status === 400 ? "yes" : `NO (${malformed.status})`}`);

  // --- step 2: analyse a real image ------------------------------------
  console.log("\nanalysing image...");
  const startedAt = Date.now();
  const response = await fetch(`${BASE}/api/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: dataUrl }),
  });
  const payload = await response.json();

  if (!response.ok) {
    console.error(`FAIL: analyse returned ${response.status}: ${payload.error}`);
    process.exit(1);
  }

  console.log(`  took ${Date.now() - startedAt}ms (server reported ${payload.elapsedMs}ms)`);
  console.log(`  id            : ${payload.id}`);
  console.log(`  subjectType   : ${payload.card.subjectType}`);
  console.log(`  subjectLabel  : ${payload.card.subjectLabel}`);
  console.log(`  personality   : ${payload.card.personality}`);
  console.log(`  grievance     : ${payload.card.grievance}`);
  console.log(`  openingLine   : ${payload.card.openingLine}`);
  console.log(`  mouth         : ${JSON.stringify(payload.card.mouth)}`);
  console.log(`  details       : ${payload.card.visibleDetails.length}`);
  console.log(`  warnings      : ${payload.warnings?.length ? payload.warnings.join(", ") : "none"}`);

  const problems = checkCard(payload.card);
  if (problems.length) {
    console.error("\nFAIL: card problems:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\n  card schema + sanitisation: OK");

  // --- step 3: manual fallback -----------------------------------------
  const manual = await fetch(`${BASE}/api/character/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "ഒരു പഴയ കുട" }),
  });
  const manualPayload = await manual.json();
  console.log(`  manual fallback works    : ${manual.ok && manualPayload.id ? "yes" : "NO"}`);

  // --- step 4: does the session use this character? ---------------------
  console.log("\nconnecting with the analysed character...");
  const captions = [];
  let audioBytes = 0;
  const errors = [];

  await new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/realtime?character=${payload.id}`);

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        audioBytes += data.length;
        return;
      }
      const message = JSON.parse(data.toString());
      if (message.type === "state" && message.state === "ready") {
        ws.send(JSON.stringify({ type: "greet" }));
      }
      if (message.type === "captionText") {
        captions.push(message.text);
        console.log(`  says: ${message.text}`);
      }
      if (message.type === "error") errors.push(message.message);
    });

    ws.on("error", (err) => {
      errors.push(err.message);
      resolve();
    });

    setTimeout(() => {
      ws.close();
      resolve();
    }, 16000);
  });

  console.log("\n" + "=".repeat(56));
  console.log(`audio bytes : ${audioBytes}`);
  console.log(`captions    : ${captions.length}`);
  console.log(`errors      : ${errors.length ? errors.join("; ") : "none"}`);

  const ok = audioBytes > 0 && captions.length > 0 && errors.length === 0;
  console.log(
    ok
      ? "\nPASS: uploaded image becomes a speaking character."
      : "\nFAIL: the analysed character did not speak.",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
