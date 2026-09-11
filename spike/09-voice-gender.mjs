/**
 * SPIKE 09 - voice selection and Malayalam gender agreement.
 *
 * Checks three things:
 *   1. The vision model suggests "female" for the Mona Lisa (documented art
 *      history) and "either" for a chair (no gender to guess).
 *   2. The chosen voice actually reaches the session.
 *   3. Self-descriptions use the matching grammatical forms. Malayalam verbs are
 *      not gender-inflected, but agent nouns are: പരാതിക്കാരൻ (m) vs
 *      പരാതിക്കാരി (f). A female voice calling itself പരാതിക്കാരൻ is the bug.
 */

import WebSocket from "ws";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");
const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";

/** Masculine agent-noun endings that should not appear with a female voice. */
const MASCULINE_MARKERS = [
  "കാരൻ", "ക്ഷീണിതൻ", "നാടകീയൻ", "ഉള്ളവൻ", "അവൻ", "ആണവൻ",
];
const FEMININE_MARKERS = [
  "കാരി", "ക്ഷീണിത", "നാടകീയ", "ഉള്ളവൾ", "അവൾ", "ആണവൾ",
];

const QUESTIONS = [
  "നിന്നെ സ്വയം വിശേഷിപ്പിക്കാമോ? നീ എങ്ങനെയുള്ള ആളാണ്?",
  "നിനക്ക് ഇവിടെ നിന്ന് മടുത്തില്ലേ?",
];

function pcmSeconds(bytes) {
  return (bytes / (24000 * 2)).toFixed(1);
}

async function analyse(imagePath) {
  const mime = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${readFileSync(imagePath).toString("base64")}`;
  const response = await fetch(`${BASE}/api/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: dataUrl }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

async function converse(characterId, voice) {
  const replies = [];
  let audioBytes = 0;

  await new Promise((resolve) => {
    const url = `${BASE.replace("http", "ws")}/realtime?character=${characterId}&voice=${voice}`;
    const ws = new WebSocket(url);
    let index = 0;
    let ready = false;

    const askNext = () => {
      if (index >= QUESTIONS.length) {
        ws.close();
        resolve();
        return;
      }
      ws.send(JSON.stringify({ type: "ask", text: QUESTIONS[index++] }));
    };

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        audioBytes += data.length;
        return;
      }
      const message = JSON.parse(data.toString());
      if (message.type === "state" && message.state === "ready" && !ready) {
        ready = true;
        askNext();
      }
      if (message.type === "captionText") {
        replies.push(message.text);
        setTimeout(askNext, 400);
      }
    });

    ws.on("error", () => resolve());
    setTimeout(() => {
      ws.close();
      resolve();
    }, 45000);
  });

  return { replies, audioBytes };
}

function countMarkers(text, markers) {
  return markers.filter((m) => text.includes(m));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const mona = join(OUT_DIR, "mona-lisa.jpg");
  const chair = join(OUT_DIR, "test-chair.png");

  if (!existsSync(mona) || !existsSync(chair)) {
    console.error("Run spike/08 and spike/make-test-image.mjs first.");
    process.exit(1);
  }

  console.log("SPIKE 09 - voice selection and gender agreement");
  console.log("=".repeat(60));

  // --- suggestion correctness ------------------------------------------
  console.log("\n[1] what does the model suggest?");
  const monaCard = await analyse(mona);
  const chairCard = await analyse(chair);

  console.log(`  mona lisa -> "${monaCard.card.suggestedVoice}"  (expect female)`);
  console.log(`  chair     -> "${chairCard.card.suggestedVoice}"  (expect either)`);

  const suggestionOk =
    monaCard.card.suggestedVoice === "female" &&
    chairCard.card.suggestedVoice === "either";
  console.log(`  suggestion behaviour: ${suggestionOk ? "correct" : "CHECK THIS"}`);

  // --- female voice + feminine forms -----------------------------------
  console.log("\n[2] Mona Lisa with the female voice");
  const female = await converse(monaCard.id, "female");
  for (const reply of female.replies) console.log(`  ${reply}`);
  console.log(`  audio: ${pcmSeconds(female.audioBytes)}s`);

  const femaleText = female.replies.join(" ");
  const strayMasculine = countMarkers(femaleText, MASCULINE_MARKERS);
  const feminineFound = countMarkers(femaleText, FEMININE_MARKERS);
  console.log(`  feminine forms found : ${feminineFound.join(", ") || "none"}`);
  console.log(`  stray masculine forms: ${strayMasculine.join(", ") || "none"}`);

  // --- male voice for contrast -----------------------------------------
  console.log("\n[3] the chair with the male voice");
  const male = await converse(chairCard.id, "male");
  for (const reply of male.replies) console.log(`  ${reply}`);
  console.log(`  audio: ${pcmSeconds(male.audioBytes)}s`);

  // --- verdict ----------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  const spoke = female.audioBytes > 0 && male.audioBytes > 0;
  console.log(`both voices produced audio : ${spoke ? "yes" : "NO"}`);
  console.log(`no masculine slip with female voice : ${strayMasculine.length === 0 ? "yes" : "NO"}`);
  console.log(
    "\nListen check: the two runs should sound like different people.",
  );
  process.exit(spoke ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
