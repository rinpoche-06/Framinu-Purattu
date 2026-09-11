/**
 * Sarvam Bulbul v3 text-to-speech, streamed.
 *
 * Why this exists: Azure has only two Malayalam voices, both Standard tier, and
 * they cannot speak mixed Malayalam-English at all. Bulbul handles code-mixed
 * text natively, which is the register this project actually wants.
 *
 * The exact request shape below was established by probing the API (spikes
 * 15-17), not from guesswork:
 *
 *   output_audio_codec: "linear16"  -> raw PCM, content-type audio/pcm
 *   speech_sample_rate: 24000       -> matches the browser player exactly
 *
 * That combination is why no browser changes were needed: the bytes pass
 * straight through to the same PCM queue Voice Live was feeding. Any other codec
 * would mean an MP3 decoder in the client, and any other rate would play at the
 * wrong pitch.
 *
 * Measured: first audio in 380-610ms, 23-27 chunks per reply.
 */

const ENDPOINT = "https://api.sarvam.ai/text-to-speech/stream";
const SAMPLE_RATE = 24000;
const MODEL = process.env.SARVAM_TTS_MODEL ?? "bulbul:v3";

/** Chosen by listening test across all 37 Malayalam-capable voices. */
export const SARVAM_VOICES = {
  male: process.env.SARVAM_VOICE_MALE ?? "gokul",
  female: process.env.SARVAM_VOICE_FEMALE ?? "roopa",
};

const PACE = Number(process.env.SARVAM_PACE ?? 1.0);

export class SarvamError extends Error {}

/**
 * Punctuation clean-up applied only to the text we send for synthesis.
 *
 * Semicolons and colons are read straight through with no pause, so
 * "നൂറ്റാണ്ടായി pose; ചായ ഇല്ല" came out as one breathless run. Commas do produce
 * a pause, so they get swapped. The model reaches for semicolons often enough
 * that relying on a prompt rule alone would leave this happening intermittently.
 *
 * Captions are left untouched: a semicolon reads perfectly well on screen, and
 * this is purely about how the words are spoken.
 */
function normaliseForSpeech(text) {
  return (
    text
      // Single-character ellipsis is less reliable than three dots.
      .replace(/…/g, "...")
      .replace(/\s*[;:]\s*/g, ", ")
      // Collapse any doubled commas the swap may have produced.
      .replace(/,\s*,+/g, ",")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Synthesise text and hand raw PCM16 chunks to a callback as they arrive.
 *
 * @param {object} options
 * @param {string} options.text what to say
 * @param {"male"|"female"} options.gender selects the cast voice
 * @param {AbortSignal} [options.signal] aborts mid-stream on barge-in
 * @param {(chunk: Buffer) => void} options.onChunk called per audio chunk
 * @returns {Promise<{bytes: number, firstChunkMs: number|null}>}
 */
export async function speak({ text, gender, signal, onChunk }) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new SarvamError("SARVAM_API_KEY is not configured");

  const trimmed = (text ?? "").trim();
  if (!trimmed) return { bytes: 0, firstChunkMs: null };

  // Second line of defence. Sarvam rejects text with no letters from a supported
  // language, so a punctuation-only fragment would come back as a 400 and show
  // the user an error for something that has no audio anyway.
  if (!/[\u0D00-\u0D7FA-Za-z]/.test(trimmed)) {
    return { bytes: 0, firstChunkMs: null };
  }

  const startedAt = Date.now();
  let response;

  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Bulbul caps at 2500 characters; our replies are far shorter, but a
        // runaway response should not produce a 400 instead of speech.
        text: normaliseForSpeech(trimmed).slice(0, 2400),
        target_language_code: "ml-IN",
        model: MODEL,
        speaker: SARVAM_VOICES[gender === "female" ? "female" : "male"],
        pace: PACE,
        output_audio_codec: "linear16",
        speech_sample_rate: SAMPLE_RATE,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return { bytes: 0, firstChunkMs: null, aborted: true };
    throw new SarvamError(`Sarvam request failed: ${err?.message ?? err}`);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new SarvamError(`Sarvam returned ${response.status}: ${detail}`);
  }

  const reader = response.body.getReader();
  let bytes = 0;
  let firstChunkMs = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstChunkMs === null) firstChunkMs = Date.now() - startedAt;
      bytes += value.length;
      onChunk(Buffer.from(value));
    }
  } catch (err) {
    // Aborting mid-stream is normal: it is what barge-in does.
    if (err?.name === "AbortError") return { bytes, firstChunkMs, aborted: true };
    throw new SarvamError(`Sarvam stream failed: ${err?.message ?? err}`);
  } finally {
    // Releasing the reader matters when we abort, or the socket lingers.
    try {
      reader.releaseLock();
    } catch {}
  }

  return { bytes, firstChunkMs };
}
