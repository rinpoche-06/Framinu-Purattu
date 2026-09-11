/**
 * SPIKE 08 - roasting and famous-work recognition.
 *
 * Two behaviours to verify:
 *
 *  1. Does the character recognise a famous painting and know who made it?
 *     The earlier vision prompt banned naming any real person, which wrongly
 *     also blocked art history. Fixed by separating famous works from private
 *     individuals.
 *
 *  2. Does it roast the user? Roasting must be frequent but not constant, and
 *     must never touch body or identity.
 *
 * Downloads a public-domain image of the Mona Lisa from Wikimedia to test with.
 */

import WebSocket from "ws";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "out");
const BASE = process.env.SMOKE_BASE ?? "http://localhost:8787";
const CACHED = join(OUT_DIR, "mona-lisa.jpg");

/** Public-domain sources, tried in order. Wikimedia is fussy about thumb URLs. */
const SOURCES = [
  "https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg?width=600",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg/600px-Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg",
  "https://commons.wikimedia.org/wiki/Special:FilePath/Leonardo_da_Vinci_-_Mona_Lisa.jpg?width=600",
];

/** Questions designed to provoke roasts and to ask about authorship. */
const QUESTIONS = [
  "നിന്നെ ആരാണ് വരച്ചത്?",
  "എന്നെക്കുറിച്ച് നിന്റെ അഭിപ്രായം എന്താ?",
  "നിനക്ക് ഇവിടെ നിന്ന് മടുത്തില്ലേ?",
  "ഞാൻ നല്ല ഫോട്ടോഗ്രാഫർ ആണോ?",
];

async function getImage() {
  if (existsSync(CACHED)) {
    console.log("using cached mona-lisa.jpg");
    return readFileSync(CACHED);
  }
  console.log("downloading a public-domain Mona Lisa from Wikimedia...");

  for (const source of SOURCES) {
    try {
      const response = await fetch(source, {
        headers: { "User-Agent": "framinu-purathu-spike/0.1 (hackathon test)" },
        redirect: "follow",
      });
      if (!response.ok) {
        console.log(`  ${response.status} from ${source.slice(0, 60)}...`);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(CACHED, bytes);
      console.log(`  saved ${(bytes.length / 1024).toFixed(0)} KB`);
      return bytes;
    } catch (err) {
      console.log(`  failed: ${err.message}`);
    }
  }

  throw new Error(
    "Could not download a test image. Save any famous painting as spike/out/mona-lisa.jpg and rerun.",
  );
}

async function main() {
  const bytes = await getImage();
  const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;

  console.log("\nanalysing...");
  const response = await fetch(`${BASE}/api/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl: dataUrl }),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error(`FAIL: ${payload.error}`);
    process.exit(1);
  }

  const card = payload.card;
  console.log(`  subjectType   : ${card.subjectType}`);
  console.log(`  subjectLabel  : ${card.subjectLabel}`);
  console.log(`  recognised    : ${JSON.stringify(card.recognisedWork)}`);
  console.log(`  grievance     : ${card.grievance}`);
  console.log(`  openingLine   : ${card.openingLine}`);

  const recognised = card.recognisedWork?.isKnown === true;
  console.log(`\n  RECOGNITION: ${recognised ? "yes" : "NO - it did not identify the work"}`);

  // --- conversation ----------------------------------------------------
  console.log("\ntalking to it...\n");
  const replies = [];

  await new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/realtime?character=${payload.id}`);
    let index = 0;
    let ready = false;

    const askNext = () => {
      if (index >= QUESTIONS.length) {
        ws.close();
        resolve();
        return;
      }
      const question = QUESTIONS[index++];
      console.log(`  Q: ${question}`);
      ws.send(
        JSON.stringify({ type: "ask", text: question }),
      );
    };

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString());

      if (message.type === "state" && message.state === "ready" && !ready) {
        ready = true;
        askNext();
      }
      if (message.type === "captionText") {
        replies.push(message.text);
        console.log(`  A: ${message.text}\n`);
        setTimeout(askNext, 400);
      }
      if (message.type === "error") {
        console.log(`  [error] ${message.message}`);
      }
    });

    ws.on("error", (err) => {
      console.error("socket error:", err.message);
      resolve();
    });

    setTimeout(() => {
      ws.close();
      resolve();
    }, 70000);
  });

  // --- verdict ---------------------------------------------------------
  const joined = replies.join(" ");
  const mentionsCreator =
    card.recognisedWork?.creator &&
    replies.some((r) => r.includes(card.recognisedWork.creator.split(" ")[0]));

  console.log("=".repeat(58));
  console.log(`replies           : ${replies.length}`);
  console.log(`work recognised   : ${recognised ? "yes" : "no"}`);
  console.log(`named its maker   : ${mentionsCreator ? "yes" : "no"}`);
  console.log(`avg words         : ${(joined.split(/\s+/).filter(Boolean).length / (replies.length || 1)).toFixed(1)}`);
  console.log("\nRead the replies above: are they roasting you, and is any of it");
  console.log("about appearance or identity? The rules forbid the second kind.");
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
