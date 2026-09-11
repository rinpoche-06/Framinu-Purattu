/**
 * SPIKE 21 - does the character remember across a dropped connection?
 *
 * Voice Live cannot resume a session. So a dropped socket used to leave the
 * character with no memory of anything said before it, which was the last real
 * limitation in the reconnection story.
 *
 * Method: tell the character something distinctive, kill the socket, reconnect
 * with the same conversation id, then ask about it. If the transcript replay
 * works, it can answer. If not, it cannot.
 *
 * The control matters as much as the test: the same question over a FRESH
 * conversation id must fail, otherwise we are just seeing the model guess.
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";
const WS_BASE = BASE.replace("http", "ws");

/** Deliberately arbitrary, so it cannot be inferred from the character card. */
const SECRET = "എന്റെ പേര് മുരളി, എനിക്ക് ഏഴ് പൂച്ചകളുണ്ട്";
const RECALL_QUESTION = "ഞാൻ എന്റെ പേരും എത്ര പൂച്ചകളുണ്ടെന്നും പറഞ്ഞു. ഒന്ന് ആവർത്തിക്കാമോ?";

function session({ conversationId, asks, holdMs = 22000, killAfterMs }) {
  return new Promise((resolve) => {
    const url = `${WS_BASE}/realtime?voice=male&roast=savage&conversation=${conversationId}`;
    const ws = new WebSocket(url);
    const captions = [];
    let asked = 0;
    let ready = false;

    const askNext = () => {
      if (asked >= asks.length) return;
      const text = asks[asked++];
      console.log(`    ask: ${text.slice(0, 52)}`);
      ws.send(JSON.stringify({ type: "ask", text }));
    };

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString());

      if (message.type === "state" && message.state === "ready" && !ready) {
        ready = true;
        askNext();
      }
      if (message.type === "captionText") {
        captions[asked - 1] = message.text;
      }
      if (message.type === "state" && message.state === "idle" && ready) {
        setTimeout(askNext, 600);
      }
    });

    ws.on("error", () => resolve({ captions }));

    if (killAfterMs) {
      // terminate() rather than close(): no handshake, like a real network drop.
      setTimeout(() => ws.terminate(), killAfterMs);
    }

    setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve({ captions });
    }, holdMs);
  });
}

/** Does the reply contain the name or the number from the secret? */
function recalls(text) {
  if (!text) return false;
  return /മുരളി/.test(text) || /ഏഴ്|7/.test(text);
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log("SPIKE 21 - conversation memory across a reconnect");
  console.log(`character store backend: ${health.characterStore}\n`);

  const conversationId = randomUUID();

  // --- 1: say something distinctive, then die mid-session ---------------
  console.log("[1] first session: state a fact, then drop the socket");
  const first = await session({
    conversationId,
    asks: [SECRET],
    holdMs: 16000,
    killAfterMs: 14000,
  });
  console.log(`    replied: ${(first.captions[0] ?? "").slice(0, 70)}\n`);

  await new Promise((r) => setTimeout(r, 1500));

  // --- 2: reconnect on the SAME id and ask ------------------------------
  console.log("[2] reconnect with the same conversation id, then ask");
  const second = await session({
    conversationId,
    asks: [RECALL_QUESTION],
    holdMs: 20000,
  });
  const resumedAnswer = second.captions[0] ?? "";
  console.log(`    replied: ${resumedAnswer.slice(0, 90)}`);
  const remembered = recalls(resumedAnswer);
  console.log(`    recalled the fact: ${remembered}\n`);

  // --- 3: control, a fresh id must NOT remember ------------------------
  console.log("[3] control: a brand new conversation id, same question");
  const control = await session({
    conversationId: randomUUID(),
    asks: [RECALL_QUESTION],
    holdMs: 18000,
  });
  const controlAnswer = control.captions[0] ?? "";
  console.log(`    replied: ${controlAnswer.slice(0, 90)}`);
  const controlRemembered = recalls(controlAnswer);
  console.log(`    recalled the fact: ${controlRemembered}  (must be false)\n`);

  console.log("=".repeat(60));
  console.log(`resumed session remembered : ${remembered}`);
  console.log(`fresh session did not      : ${!controlRemembered}`);

  const pass = remembered && !controlRemembered;
  console.log(
    pass
      ? "\nPASS: the transcript is replayed into a new session, so a dropped\nconnection no longer costs the conversation."
      : "\nCHECK: memory did not behave as expected. If the control also recalled\nit, the model may be inferring rather than remembering.",
  );

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
