/**
 * SPIKE 14 - casting the voice.
 *
 * Nothing in the application is modified. This writes wav files only.
 *
 * The brief: a TIRED voice that is ANGRY about being imprisoned in a picture for
 * centuries. Bulbul v3 has no emotion parameter — pitch and loudness were
 * dropped from v2, leaving only pace and temperature. So emotion has to come
 * from three places:
 *
 *   1. Which of the 38 speakers we cast  <- the big lever, tested here
 *   2. Pace, for weariness
 *   3. The text itself, since v3 infers prosody from wording and punctuation
 *
 * Auditioning all 38 costs about ₹6, which is cheaper than guessing from names
 * and running several rounds. The line is deliberately short so listening to the
 * whole catalogue takes a couple of minutes.
 *
 * Run with a voice name to hear a longer line at three paces:
 *   node spike/14-voice-casting.mjs ratan
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.SARVAM_API_KEY;
const URL = "https://api.sarvam.ai/text-to-speech";
const MODEL = "bulbul:v3";
const LANGUAGE = "ml-IN";

/** Short, so 38 clips are quick to get through. Tired, angry, imprisoned. */
const AUDITION_LINE = "ഛേ! നൂറ്റാണ്ടുകളായി ഇതേ ഭാവം... എനിക്ക് മടുത്തു!";

/** Longer line for the finalists, to hear the character sustained. */
const FINALIST_LINE =
  "ഛേ! നൂറ്റാണ്ടുകളായി ഞാൻ ഇതേ ഭാവത്തിൽ നിൽക്കുന്നു... ഒരു ചുവട് വെക്കാൻ പോലും വഴിയില്ല. ഈ ഫ്രെയിം എന്റെ ജയിലാണ്!";

/**
 * A real reply the character produced, with three English words in it.
 *
 * The original audition used pure Malayalam, because Manglish was not possible
 * on Azure at the time. Code-mixing is a different skill: the voice has to
 * switch phonology mid-sentence and switch back. gokul was cast before that was
 * ever tested, and reportedly stumbles on it where roopa is smooth.
 */
const MANGLISH_LINE =
  "എന്റമ്മോ... പുറത്തു പോകാൻ permission ഇല്ല... ഫ്രെയിം തന്നെയാണ് ലോകം, നിന്റെ camera മാത്രം വാതിൽ, പക്ഷേ freedom ഫോട്ടോ സൈസ്!";

const MALE = [
  "shubh", "aditya", "rahul", "rohan", "amit", "dev", "ratan", "varun",
  "manan", "sumit", "kabir", "aayan", "ashutosh", "advait", "anand", "tarun",
  "sunny", "mani", "gokul", "vijay", "mohit", "rehan", "soham",
];

const FEMALE = [
  "ritu", "priya", "neha", "pooja", "simran", "kavya", "ishita", "shreya",
  "roopa", "tanya", "shruti", "suhani", "kavitha", "rupali",
];

/** Slightly slow, because a weary character at full pace does not read weary. */
const AUDITION_PACE = 0.9;

/**
 * Shortlist for the second round.
 *
 * Derived from the first audition: every clip was the same text at the same
 * pace, so audio length is proportional to how deliberately each voice speaks.
 * These are the slowest, heaviest deliveries in each group.
 *
 * This is a proxy for weariness, not a measurement of it. A slow voice is not
 * automatically an angry one, so the shortlist narrows the field rather than
 * picking the winner.
 */
const SHORTLIST = {
  male: ["advait", "tarun", "aditya", "varun", "vijay"],
  female: ["kavitha", "neha", "priya", "simran", "tanya"],
};

/** Slower still for the finalists: the character is exhausted, not brisk. */
const SHORTLIST_PACE = 0.85;

async function synthesise({ text, speaker, pace }) {
  const response = await fetch(URL, {
    method: "POST",
    headers: { "api-subscription-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      target_language_code: LANGUAGE,
      model: MODEL,
      speaker,
      pace,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return { ok: false, detail: `${response.status} ${raw.slice(0, 140).replace(/\s+/g, " ")}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, detail: "unparseable response" };
  }

  const base64 = Array.isArray(parsed.audios) ? parsed.audios[0] : parsed.audio;
  if (!base64) return { ok: false, detail: `no audio. keys: ${Object.keys(parsed).join(", ")}` };
  return { ok: true, bytes: Buffer.from(base64, "base64") };
}

/** Mode 2: one chosen voice, longer line, three paces. */
async function finalistRound(speaker) {
  const outDir = join(__dirname, "out", "sarvam-finalist");
  mkdirSync(outDir, { recursive: true });

  console.log(`SPIKE 14 - finalist round for "${speaker}"`);
  console.log(`Output: spike/out/sarvam-finalist/\n`);

  let characters = 0;
  // Uses the code-mixed line, because that is where problems actually show up.
  // The pure-Malayalam line sounded fine on voices that stumble on Manglish,
  // which is how the original casting went wrong.
  //
  // Range covers slower-than-normal: the reported artefact is the final English
  // word being rushed, and giving the voice more room is the obvious remedy.
  // Both directions, because the two complaints pull opposite ways: the final
  // English word sounds rushed (wants slower) while some earlier samples at 1.1
  // were preferred (wants faster). Those earlier samples were pure Malayalam
  // though, so they could not expose the rushing at all.
  for (const pace of [0.95, 1.0, 1.05, 1.1]) {
    const id = `${speaker}-pace-${String(pace).replace(".", "")}`;
    process.stdout.write(`  ${id.padEnd(24)} `);
    const result = await synthesise({ text: MANGLISH_LINE, speaker, pace });
    if (!result.ok) {
      console.log(`FAILED  ${result.detail}`);
      continue;
    }
    characters += MANGLISH_LINE.length;
    writeFileSync(join(outDir, `${id}.wav`), result.bytes);
    const seconds = ((result.bytes.length - 44) / 48000).toFixed(1);
    console.log(`ok  ${seconds}s`);
  }

  console.log(`\ncharacters billed: ~${characters} (about ₹${((characters / 1000) * 3).toFixed(2)})`);
  console.log("\nListen to the final word, 'freedom'. If 0.95 or 0.9 stops it being");
  console.log("rushed, set SARVAM_PACE in .env. That applies to both voices.");
}

/** Mode 1: the full catalogue. */
async function auditionAll() {
  const outDir = join(__dirname, "out", "sarvam-casting");
  mkdirSync(outDir, { recursive: true });

  console.log("SPIKE 14 - voice casting audition");
  console.log("Nothing in the app is modified. Output: spike/out/sarvam-casting/\n");
  console.log(`line : ${AUDITION_LINE}`);
  console.log(`pace : ${AUDITION_PACE}   voices: ${MALE.length + FEMALE.length}\n`);

  let characters = 0;
  const failures = [];

  const groups = [
    { prefix: "m", label: "male", voices: MALE },
    { prefix: "f", label: "female", voices: FEMALE },
  ];

  for (const group of groups) {
    console.log(`  --- ${group.label} ---`);
    for (let i = 0; i < group.voices.length; i++) {
      const speaker = group.voices[i];
      const id = `${group.prefix}${String(i + 1).padStart(2, "0")}-${speaker}`;
      process.stdout.write(`  ${id.padEnd(18)} `);

      const result = await synthesise({
        text: AUDITION_LINE,
        speaker,
        pace: AUDITION_PACE,
      });

      if (!result.ok) {
        console.log(`FAILED  ${result.detail}`);
        failures.push({ id, detail: result.detail });
        continue;
      }

      characters += AUDITION_LINE.length;
      writeFileSync(join(outDir, `${id}.wav`), result.bytes);
      console.log(`ok  ${(result.bytes.length / 1024).toFixed(0)} KB`);
    }
  }

  console.log("\n" + "=".repeat(62));
  console.log(`characters billed: ~${characters} (about ₹${((characters / 1000) * 3).toFixed(2)})`);

  if (failures.length) {
    console.log(`\n${failures.length} voice(s) unavailable for Malayalam:`);
    for (const f of failures) console.log(`  ${f.id}: ${f.detail}`);
  }

  console.log("\nHOW TO LISTEN");
  console.log("  Each clip is about 4 seconds. Play through the male folder");
  console.log("  entries first if the character is the chair, or the female ones");
  console.log("  if you are casting the Mona Lisa.");
  console.log("");
  console.log("  You are listening for ONE thing: does this voice sound like it");
  console.log("  has been stuck in a picture for three hundred years and is");
  console.log("  furious about it?");
  console.log("");
  console.log("  Then run the finalist round on your favourite:");
  console.log("    node spike/14-voice-casting.mjs <name>");
  console.log("  That plays a longer line at pace 0.8, 0.9 and 1.0.");
}

/**
 * Mode 3: the shortlisted voices on the full character line, so one male and one
 * female can be chosen for every uploaded picture.
 */
async function shortlistRound() {
  const outDir = join(__dirname, "out", "sarvam-shortlist");
  mkdirSync(outDir, { recursive: true });

  console.log("SPIKE 14 - shortlist round");
  console.log("Nothing in the app is modified. Output: spike/out/sarvam-shortlist/\n");
  console.log(`line : ${FINALIST_LINE}`);
  console.log(`pace : ${SHORTLIST_PACE}\n`);

  let characters = 0;

  for (const [label, voices] of Object.entries(SHORTLIST)) {
    console.log(`  --- ${label} ---`);
    for (const speaker of voices) {
      const id = `${label === "male" ? "M" : "F"}-${speaker}`;
      process.stdout.write(`  ${id.padEnd(16)} `);
      const result = await synthesise({
        text: FINALIST_LINE,
        speaker,
        pace: SHORTLIST_PACE,
      });
      if (!result.ok) {
        console.log(`FAILED  ${result.detail}`);
        continue;
      }
      characters += FINALIST_LINE.length;
      writeFileSync(join(outDir, `${id}.wav`), result.bytes);
      console.log(`ok  ${(result.bytes.length / 1024).toFixed(0)} KB`);
    }
  }

  console.log("\n" + "=".repeat(62));
  console.log(`characters billed: ~${characters} (about ₹${((characters / 1000) * 3).toFixed(2)})`);
  console.log("\nPick ONE male and ONE female. They will be used for every");
  console.log("uploaded picture, so choose the voice that sounds most like it has");
  console.log("been trapped in a frame for centuries and resents it.");
  console.log("\nThen tune the weariness on your pick:");
  console.log("  node spike/14-voice-casting.mjs <name>");
}

/**
 * Mode 4: every male voice on a genuinely code-mixed line.
 *
 * This is the test that should have been run before casting. roopa is included
 * as a reference, since it is the voice reported as smooth — anything that does
 * not hold up next to it is not good enough.
 */
async function manglishRound(group = "male") {
  const outDir = join(__dirname, "out", `sarvam-manglish-${group}`);
  mkdirSync(outDir, { recursive: true });

  const candidates = group === "female" ? FEMALE : MALE;
  // tarun was picked on this exact line, so it is the known-good benchmark.
  const reference = group === "female" ? "tarun" : "roopa";

  console.log(`SPIKE 14 - ${group} voices on a code-mixed line`);
  console.log(`Nothing in the app is modified. Output: spike/out/sarvam-manglish-${group}/\n`);
  console.log(`line : ${MANGLISH_LINE}\n`);

  let characters = 0;

  // Reference first, so the standard is set before the candidates.
  const entries = [
    { speaker: reference, id: `00-REFERENCE-${reference}` },
    ...candidates.map((speaker, index) => ({
      speaker,
      id: `${String(index + 1).padStart(2, "0")}-${speaker}`,
    })),
  ];

  for (const entry of entries) {
    process.stdout.write(`  ${entry.id.padEnd(22)} `);
    const result = await synthesise({ text: MANGLISH_LINE, speaker: entry.speaker, pace: 1.0 });
    if (!result.ok) {
      console.log(`FAILED  ${result.detail}`);
      continue;
    }
    characters += MANGLISH_LINE.length;
    writeFileSync(join(outDir, `${entry.id}.wav`), result.bytes);
    const seconds = ((result.bytes.length - 44) / 48000).toFixed(1);
    console.log(`ok  ${seconds}s`);
  }

  console.log("\n" + "=".repeat(62));
  console.log(`characters billed: ~${characters} (about ₹${((characters / 1000) * 3).toFixed(2)})`);
  console.log(`\nPlay 00-REFERENCE-${reference} first to set the standard, then find`);
  console.log(`a ${group} voice that handles the three English words as smoothly.`);
  console.log("\nListen specifically at the switches: permission, camera, freedom.");
  console.log("A stumble shows up as a hesitation or wrong stress right there,");
  console.log("not spread across the sentence.");
  console.log("\n'freedom' is the hardest of the three: it sits at the end, where");
  console.log("voices tend to rush. If a voice is going to fall apart, it happens");
  console.log("there.");
  console.log(
    `\nTo use a winner: set SARVAM_VOICE_${group.toUpperCase()} in .env and restart.`,
  );
}

async function main() {
  if (!API_KEY) {
    console.error("[FAIL] SARVAM_API_KEY is not set in .env");
    process.exit(1);
  }

  const requested = process.argv[2];

  if (requested === "shortlist") {
    await shortlistRound();
    return;
  }

  if (requested === "manglish") {
    await manglishRound(process.argv[3] === "female" ? "female" : "male");
    return;
  }

  if (requested) {
    const known = [...MALE, ...FEMALE];
    if (!known.includes(requested)) {
      console.error(`Unknown voice "${requested}".`);
      console.error(`Male:   ${MALE.join(", ")}`);
      console.error(`Female: ${FEMALE.join(", ")}`);
      process.exit(1);
    }
    await finalistRound(requested);
    return;
  }

  await auditionAll();
}

main().catch((err) => {
  console.error("[FATAL]", err?.message ?? err);
  process.exit(1);
});
