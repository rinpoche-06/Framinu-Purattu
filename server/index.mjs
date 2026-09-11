/**
 * Framinu Purathu backend.
 *
 * Why this exists: we only have a long-lived Azure API key, not Entra
 * credentials, so there is no way to mint a short-lived browser token. Putting
 * the key in client code would ship a permanent secret to every visitor.
 *
 * So the Voice Live session lives here. The browser opens its own WebSocket to
 * this server and exchanges raw PCM16 audio plus small JSON control messages.
 * One browser socket == one Voice Live session, torn down together.
 */

import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { VoiceLiveClient } from "@azure/ai-voicelive";
import { AzureKeyCredential } from "@azure/core-auth";
import { CHAIR, buildSessionConfig } from "./character.mjs";
import { analyseImage, VisionError, visionModelName } from "./vision.mjs";
import { buildInstructions, validateCard } from "./characterCard.mjs";
import { SARVAM_VOICES, speak as sarvamSpeak } from "./sarvamTts.mjs";
import { createCharacterStore } from "./characterStore.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const ENDPOINT = process.env.AZURE_VOICELIVE_ENDPOINT;
const API_KEY = process.env.AZURE_VOICELIVE_API_KEY;
const MODEL = process.env.AZURE_VOICELIVE_MODEL ?? "gpt-realtime-2.1";
const VOICE = process.env.AZURE_VOICELIVE_VOICE ?? "ml-IN-MidhunNeural";
const STT_LANGUAGES = process.env.AZURE_VOICELIVE_STT_LANGUAGES ?? "ml-IN,en-IN";
const DEBUG = process.env.DEBUG === "true";

/**
 * Which engine speaks.
 *
 *   azure  - Voice Live synthesises with ml-IN Azure voices. Fewer moving parts,
 *            but Standard tier only and cannot speak mixed Malayalam-English.
 *   sarvam - Voice Live returns text, Sarvam Bulbul speaks it. Better voice and
 *            code-mixing works, at the cost of a second provider.
 *
 * A flag rather than a rewrite, so switching back is an env change and needs no
 * code revert.
 */
const TTS_PROVIDER = (process.env.TTS_PROVIDER ?? "azure").toLowerCase();
const USE_SARVAM = TTS_PROVIDER === "sarvam";

if (!ENDPOINT || !API_KEY) {
  console.error("[fatal] AZURE_VOICELIVE_ENDPOINT and AZURE_VOICELIVE_API_KEY must be set in .env");
  process.exit(1);
}

const app = express();

// Images arrive as data URLs. Resizing happens in the browser before upload, so
// this ceiling exists to reject abuse, not normal photos.
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    ttsProvider: TTS_PROVIDER,
    voices: USE_SARVAM ? SARVAM_VOICES : VOICES,
    visionModel: visionModelName,
    characterStore: characters.backend,
  });
});

/** The built-in fallback character, used when nothing has been uploaded. */
app.get("/api/character", (_req, res) => {
  res.json({
    id: CHAIR.id,
    label: CHAIR.label,
    imageUrl: CHAIR.imageUrl,
    mouth: CHAIR.mouth,
    openingLine: CHAIR.openingLine,
  });
});

/**
 * Character store. Cards live in memory only and are never written to disk:
 * we do not persist uploaded images, transcripts or generated personalities.
 * Bounded so a long session cannot grow without limit.
 */
/**
 * We store the card, not finished instructions, because the prompt depends on
 * the voice the user picks afterwards. Malayalam self-descriptions are gendered,
 * so the same card produces two different prompts.
 *
 * Backed by Redis when REDIS_URL is set, memory otherwise. Nothing depends on
 * Redis being up.
 */
const characters = await createCharacterStore({
  url: process.env.REDIS_URL,
  log: (message) => console.log(message),
});

/** Malayalam has exactly two voices on Azure, so this is the whole palette. */
const VOICES = {
  male: VOICE,
  female: process.env.AZURE_VOICELIVE_VOICE_FEMALE ?? "ml-IN-SobhanaNeural",
};

function resolveVoice(requested) {
  return requested === "female" ? "female" : "male";
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * How long the user may stay silent before the character prods them.
 *
 * 20 seconds rather than 10, because a presenter pauses to explain things to the
 * room. At 10s the character talked over those explanations, and with
 * push-to-talk it has no way of knowing you are busy addressing humans.
 * Configurable so it can be pushed further out for a long presentation.
 */
const IDLE_PROD_MS = Number(process.env.IDLE_PROD_MS ?? 20000);

/** Stop after this many unanswered prods, so it nags rather than harasses. */
const IDLE_PROD_LIMIT = 3;

/**
 * Hidden prompts for idle prodding. Escalating, so a long silence becomes a
 * small comic arc rather than the same line three times.
 */
const IDLE_PROMPTS = [
  "ഉപയോക്താവ് കുറച്ചു നേരം ഒന്നും പറഞ്ഞില്ല. ഒരു ചെറിയ കുത്തുവാക്കോടെ അവരെ വിളിക്കുക.",
  "ഇപ്പോഴും ഒന്നും പറയുന്നില്ല. കൂടുതൽ അക്ഷമയോടെ ഒരു വാചകം പറയുക.",
  "ഇത് മൂന്നാം തവണയാണ്. നാടകീയമായി പരിഭവിച്ച്, പോകാൻ ഒരുങ്ങുന്നതുപോലെ ഒരു വാചകം പറയുക.",
];

app.post("/api/analyse", async (req, res) => {
  const dataUrl = req.body?.imageDataUrl;

  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return res.status(400).json({ error: "Expected an image data URL." });
  }

  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  if (!ALLOWED_IMAGE_TYPES.has(mime)) {
    return res
      .status(415)
      .json({ error: `Unsupported image type "${mime}". Use JPEG, PNG or WebP.` });
  }

  const startedAt = Date.now();
  try {
    const raw = await analyseImage(dataUrl);
    const { card, warnings } = validateCard(raw);
    const id = await characters.store(card);

    console.log(
      `[analyse] ${card.subjectType} "${card.subjectLabel}" in ${Date.now() - startedAt}ms` +
        (warnings.length ? ` (defaulted: ${warnings.join(", ")})` : ""),
    );

    res.json({ id, card, warnings, elapsedMs: Date.now() - startedAt });
  } catch (err) {
    const message = err instanceof VisionError ? err.message : "Image analysis failed.";
    console.error("[analyse] failed:", err?.message ?? err);
    // The client can still continue by describing the subject manually, so this
    // is a recoverable error rather than a dead end.
    res.status(502).json({ error: message, recoverable: true });
  }
});

/**
 * Re-register a card the client already holds.
 *
 * Cards live in memory only, so a server restart forgets them while the browser
 * still has the picture on screen. Rather than silently reverting to the demo
 * chair, the client sends the card back and carries on with the same character.
 *
 * The card is re-validated on the way in: it arrives from the client, so it is
 * no more trustworthy than any other request body.
 */
app.post("/api/character/restore", async (req, res) => {
  const incoming = req.body?.card;
  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ error: "Expected a character card." });
  }

  const { card } = validateCard({
    ...incoming,
    // validateCard reads the mouth from mouthSuggestion, which is the shape the
    // vision model returns rather than the shape we hand to the client.
    mouthSuggestion: incoming.mouth ?? incoming.mouthSuggestion,
  });
  const id = await characters.store(card);
  console.log(`[restore] "${card.subjectLabel}" re-registered as ${id}`);
  res.json({ id, card });
});

/**
 * Manual fallback for when analysis fails or the subject is misread. The user
 * describes the subject themselves and we build a card from that.
 */
app.post("/api/character/manual", async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label : "";
  if (!label.trim()) {
    return res.status(400).json({ error: "Describe the subject in a few words." });
  }

  const { card } = validateCard({
    subjectType: "unclear",
    subjectLabel: label,
    visibleDetails: Array.isArray(req.body?.visibleDetails) ? req.body.visibleDetails : [],
    mouthSuggestion: req.body?.mouth,
  });
  const id = await characters.store(card);
  res.json({ id, card, warnings: [], elapsedMs: 0 });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/realtime" });

const client = new VoiceLiveClient(ENDPOINT, new AzureKeyCredential(API_KEY));

let connectionCounter = 0;

wss.on("connection", (browser, request) => {
  const id = ++connectionCounter;
  const log = (...args) => console.log(`[conn ${id}]`, ...args);

  // The character is chosen at connect time via query string, so the session is
  // configured correctly on the first update instead of needing a round trip.
  const params = new URL(request.url ?? "/", "http://localhost").searchParams;
  const requestedId = params.get("character");
  const voiceGender = resolveVoice(params.get("voice"));
  const voiceName = VOICES[voiceGender];
  // Savage is the default: it is the funnier setting, and "normal" exists for
  // when strangers are trying it rather than the person who asked for it.
  const roastIntensity = params.get("roast") === "normal" ? "normal" : "savage";
  // Identifies the conversation across reconnects and page reloads. Minted by
  // the browser and kept in its session snapshot, because the provider offers no
  // session resume of its own.
  const conversationId = params.get("conversation");
  /** Set once history has been replayed, so the greeting adapts. */
  let resumedHistory = 0;

  // Instructions are assembled per connection rather than at analysis time,
  // because Malayalam self-description is gendered and depends on the chosen
  // voice. Code-mixing is only allowed when Sarvam is speaking: Azure's ml-IN
  // voices render mixed script unintelligibly.
  const promptOptions = { allowCodeMixing: USE_SARVAM, roastIntensity };

  // Resolved inside start(), since the card lookup is async once it can come
  // from Redis. Read afterwards by the greet and escape handlers.
  let characterMissing = false;
  let character = {
    instructions: buildInstructions(CHAIR.card, voiceGender, promptOptions),
    openingLine: CHAIR.openingLine,
  };

  /**
   * Rebuild the conversation in a fresh provider session.
   *
   * Voice Live cannot resume a session, so a dropped connection or a page reload
   * previously left the character with no memory of anything said. Replaying the
   * stored turns as conversation items restores that context without generating
   * any speech, so callbacks and running jokes survive an interruption.
   *
   * Costs one prompt's worth of tokens per turn, which is why the store caps how
   * many are kept.
   */
  const replayHistory = async () => {
    if (!conversationId || !session) return;

    const turns = await characters.getTurns(conversationId);
    if (turns.length === 0) return;

    try {
      for (const turn of turns) {
        await session.addConversationItem({
          type: "message",
          role: turn.role === "assistant" ? "assistant" : "user",
          content: [
            turn.role === "assistant"
              ? { type: "text", text: turn.text }
              : { type: "input_text", text: turn.text },
          ],
        });
      }
      resumedHistory = turns.length;
      log(`replayed ${turns.length} turns from the previous session`);
    } catch (err) {
      // Not fatal: the conversation simply starts fresh, which is how it behaved
      // before this existed.
      log(`history replay failed: ${err?.message}`);
    }
  };

  const resolveCharacter = async () => {
    if (!requestedId) return;

    const card = await characters.get(requestedId);
    if (card) {
      character = {
        instructions: buildInstructions(card, voiceGender, promptOptions),
        openingLine: card.openingLine,
      };
      return;
    }

    // Falling back to the chair silently would be the worst outcome: not an
    // error, just quietly the wrong character. Tell the client instead, so it
    // can re-register the card it still holds.
    characterMissing = true;
    log(`unknown character "${requestedId}", asking the client to restore it`);
  };

  let session = null;
  let subscription = null;
  let closed = false;

  // --- idle prodding ---------------------------------------------------
  // If the user goes quiet the character speaks unprompted, which turns dead
  // air into personality. Capped so it does not nag forever or burn quota.
  let idleTimer = null;
  let idleProds = 0;
  let responseActive = false;

  // --- truncation bookkeeping ------------------------------------------
  // The id of the assistant item currently speaking, and how much audio we have
  // sent for it. The sent figure is the upper bound for truncation: the service
  // errors if asked to truncate beyond the real audio duration.
  //
  // Only meaningful on the Azure path. With Sarvam, Voice Live produces no audio
  // item to truncate, so barge-in is handled by aborting the Sarvam stream and
  // telling the model it was cut off. Documented as a tradeoff.
  let currentItemId = null;
  let sentAudioMs = 0;

  // --- Sarvam speech pipeline -------------------------------------------
  //
  // Voice Live used to stream audio while the model was still composing, so the
  // first sound arrived in about a second. Waiting for the complete reply text
  // before synthesising pushed that to nearly four seconds.
  //
  // So we synthesise sentence by sentence as text arrives. The first sentence is
  // usually short, which brings first audio back down, and later sentences are
  // synthesised while earlier ones are still playing.
  let ttsAbort = null;
  let ttsGeneration = 0;
  let pendingSpeech = 0;
  let replyTextComplete = false;
  let sentenceBuffer = "";
  let spokenText = "";
  let ttsChain = Promise.resolve();
  let firstAudioAt = null;
  let replyStartedAt = 0;

  /**
   * Minimum length before a fragment gets its own request.
   *
   * Every fragment is synthesised as an isolated utterance, so a fragment that
   * is not a natural unit of speech gets sentence-final intonation applied to
   * something that is not a sentence. That is what makes words near the seams
   * sound subtly wrong.
   *
   * Higher values mean fewer, more natural fragments and slightly later first
   * audio. 12 is enough to stop a bare interjection like "അയ്യോ..." being spoken
   * on its own, so it stays attached to the clause that follows it.
   */
  const MIN_FLUSH_CHARS = Number(process.env.TTS_MIN_FLUSH_CHARS ?? 12);

  /**
   * Splitting at commas was measurably worse for quality: a comma is not an
   * utterance boundary, so the model applied a falling, finished-sentence
   * contour to text that was still mid-thought.
   *
   * Off by default. Enable only if first-audio latency matters more than how the
   * speech sounds.
   */
  const CLAUSE_SPLIT_CHARS = Number(process.env.TTS_CLAUSE_SPLIT_CHARS ?? 0);

  const stopSarvam = () => {
    // Bumping the generation makes queued sentences no-ops without needing to
    // reach into the promise chain.
    ttsGeneration += 1;
    pendingSpeech = 0;
    sentenceBuffer = "";
    spokenText = "";
    replyTextComplete = false;
    ttsChain = Promise.resolve();
    if (ttsAbort) {
      ttsAbort.abort();
      ttsAbort = null;
    }
  };

  /** Called once the text is complete and every sentence has been spoken. */
  const finishReply = () => {
    if (!replyTextComplete || pendingSpeech > 0) return;
    if (firstAudioAt !== null) {
      log(`reply spoken, first audio ${firstAudioAt - replyStartedAt}ms after text started`);
    }
    send({ type: "state", state: "idle" });
    scheduleIdleProd();
  };

  const speakSentence = async (text, generation) => {
    if (generation !== ttsGeneration) return;

    const controller = new AbortController();
    ttsAbort = controller;

    try {
      const result = await sarvamSpeak({
        text,
        gender: voiceGender,
        signal: controller.signal,
        onChunk: (chunk) => {
          if (generation !== ttsGeneration) return;
          if (firstAudioAt === null) firstAudioAt = Date.now();
          if (browser.readyState === browser.OPEN) {
            browser.send(chunk, { binary: true });
          }
        },
      });
      if (result.aborted && DEBUG) log("sarvam aborted mid-sentence");
    } catch (err) {
      log("sarvam failed:", err?.message);
      // The conversation survives; this turn is just silent. Say so rather than
      // leaving the UI stuck on "thinking".
      send({
        type: "error",
        message: "The voice engine failed on that reply. Captions still work.",
      });
    } finally {
      if (ttsAbort === controller) ttsAbort = null;
      if (generation === ttsGeneration) {
        pendingSpeech -= 1;
        finishReply();
      }
    }
  };

  /**
   * Does this fragment contain anything actually speakable?
   *
   * Splitting can leave a remainder of pure punctuation — a reply ending
   * "ചിരിക്കും...!" flushes at the ellipsis and leaves "!" behind. Sarvam rejects
   * that with "Text must contain at least one character from the allowed
   * languages", which surfaced as an occasional failed reply.
   *
   * Malayalam script or Latin letters both count, since code-mixing is allowed.
   */
  const hasSpeakableContent = (text) => /[\u0D00-\u0D7FA-Za-z]/.test(text);

  /** Queue a sentence, keeping playback order by chaining the promises. */
  const enqueueSentence = (text) => {
    // Dropped rather than sent: a lone "!" carries no audio anyway, and sending
    // it costs a failed request and an error banner.
    if (!hasSpeakableContent(text)) {
      if (DEBUG) log(`skipped unspeakable fragment: ${JSON.stringify(text)}`);
      return;
    }
    const generation = ttsGeneration;
    pendingSpeech += 1;
    spokenText = `${spokenText} ${text}`.trim();
    // Captions grow as each sentence is spoken, which also helps comprehension.
    send({ type: "captionText", text: spokenText });
    ttsChain = ttsChain.then(() => speakSentence(text, generation));
  };

  /**
   * Pull the earliest usable sentence out of the buffer.
   *
   * Two things this has to get right:
   *
   * A run of dots is one terminator. The character uses "..." constantly for
   * comic timing, and splitting inside it produces two broken fragments.
   *
   * We take the EARLIEST terminator that yields a long-enough fragment, not the
   * last. Taking the last maximised fragment size, which sounds better but meant
   * most replies waited for the entire text before any audio started, defeating
   * the point of incremental synthesis.
   */
  const flushSentences = (force) => {
    for (let i = 0; i < sentenceBuffer.length; i++) {
      if (!".!?…".includes(sentenceBuffer[i])) continue;

      // Advance past the whole run so "..." is treated as a single boundary.
      let end = i;
      while (end + 1 < sentenceBuffer.length && ".…".includes(sentenceBuffer[end + 1])) {
        end += 1;
      }

      // A trailing run at the very end of the buffer may still be growing, so
      // wait unless we are forcing the flush.
      if (!force && end === sentenceBuffer.length - 1 && ".…".includes(sentenceBuffer[end])) {
        break;
      }

      const candidate = sentenceBuffer.slice(0, end + 1).trim();
      if (candidate.length < MIN_FLUSH_CHARS) {
        i = end; // too short on its own; keep it attached to what follows
        continue;
      }

      sentenceBuffer = sentenceBuffer.slice(end + 1);
      if (candidate) enqueueSentence(candidate);
      return;
    }

    // Optional fallback, disabled by default. Breaks mid-thought at a clause
    // boundary to start speech sooner, at a cost in naturalness.
    if (!force && CLAUSE_SPLIT_CHARS > 0 && sentenceBuffer.length >= CLAUSE_SPLIT_CHARS) {
      let clauseEnd = -1;
      for (let i = 0; i < sentenceBuffer.length; i++) {
        if (",;:".includes(sentenceBuffer[i])) clauseEnd = i;
      }
      if (clauseEnd >= MIN_FLUSH_CHARS) {
        const candidate = sentenceBuffer.slice(0, clauseEnd + 1).trim();
        sentenceBuffer = sentenceBuffer.slice(clauseEnd + 1);
        if (candidate) enqueueSentence(candidate);
      }
    }

    if (force) {
      const remainder = sentenceBuffer.trim();
      sentenceBuffer = "";
      if (remainder) enqueueSentence(remainder);
    }
  };

  /** Small JSON envelope to the browser. Audio goes as binary frames. */
  const send = (message) => {
    if (browser.readyState === browser.OPEN) {
      browser.send(JSON.stringify(message));
    }
  };

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  /** Called after each response finishes, and reset whenever the user acts. */
  const scheduleIdleProd = () => {
    clearIdleTimer();
    if (closed || idleProds >= IDLE_PROD_LIMIT) return;
    idleTimer = setTimeout(() => {
      void sendIdleProd();
    }, IDLE_PROD_MS);
  };

  const sendIdleProd = async () => {
    idleTimer = null;
    if (closed || !session || responseActive) return;

    const prompt = IDLE_PROMPTS[Math.min(idleProds, IDLE_PROMPTS.length - 1)];
    idleProds += 1;
    log(`idle prod ${idleProds}`);

    try {
      await session.addConversationItem({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      });
      await session.sendEvent({ type: "response.create" });
    } catch (err) {
      log("idle prod failed:", err?.message);
    }
  };

  /** Any deliberate user action means they are still there. */
  const noteUserActivity = () => {
    idleProds = 0;
    clearIdleTimer();
  };

  const cleanup = async (reason) => {
    if (closed) return;
    closed = true;
    clearIdleTimer();
    stopSarvam();
    log(`cleanup: ${reason}`);
    try {
      await subscription?.close();
    } catch {}
    try {
      await session?.disconnect();
    } catch {}
    try {
      await session?.dispose();
    } catch {}
    session = null;
    subscription = null;
    if (browser.readyState === browser.OPEN) browser.close();
  };

  const start = async () => {
    send({ type: "state", state: "connecting" });
    // Before the session is configured, since the instructions depend on it.
    await resolveCharacter();
    session = client.createSession({ model: MODEL });

    subscription = session.subscribe({
      onServerEvent: async (event) => {
        if (DEBUG) log("event", event.type);
      },

      onSessionUpdated: async () => {
        if (characterMissing) send({ type: "characterMissing" });
        send({ type: "state", state: "ready" });
      },

      // What the user said. Useful for captions and for debugging Malayalam
      // recognition, which is the shakiest part of the pipeline.
      onConversationItemInputAudioTranscriptionCompleted: async (event) => {
        const text = event.transcript?.trim();
        if (text) {
          log(`user: ${text}`);
          send({ type: "userTranscript", text });
          void characters.appendTurn(conversationId, { role: "user", text });
        }
      },

      onInputAudioBufferSpeechStarted: async () => {
        noteUserActivity();
        // Barge-in on the Sarvam path: abort synthesis so we stop paying for
        // and streaming audio the user has already talked over.
        stopSarvam();
        send({ type: "state", state: "listening" });
        // Barge-in: the user talking over the character must stop playback
        // immediately, both here and in the browser's audio queue. The browser
        // replies with how much it actually played so we can truncate.
        send({ type: "interrupted" });
        try {
          await session?.sendEvent({ type: "response.cancel" });
        } catch (err) {
          const msg = String(err?.message ?? "");
          if (!msg.toLowerCase().includes("no active response")) {
            log("cancel failed:", msg);
          }
        }
      },

      onInputAudioBufferSpeechStopped: async () => {
        send({ type: "state", state: "thinking" });
      },

      onResponseCreated: async () => {
        responseActive = true;
        clearIdleTimer();
        send({ type: "state", state: "thinking" });
      },

      // Gives us the assistant item id, which truncation needs to address.
      onResponseOutputItemAdded: async (event) => {
        const item = event.item;
        if (item?.id) {
          currentItemId = item.id;
          sentAudioMs = 0;
          if (USE_SARVAM) {
            // Fresh reply: reset the sentence pipeline and start the clock.
            ttsGeneration += 1;
            pendingSpeech = 0;
            sentenceBuffer = "";
            spokenText = "";
            replyTextComplete = false;
            ttsChain = Promise.resolve();
            firstAudioAt = null;
            replyStartedAt = Date.now();
          }
          send({ type: "responseStart", itemId: item.id });
        }
      },

      onResponseAudioDelta: async (event) => {
        if (!event.delta) return;
        const chunk = Buffer.from(event.delta, "base64");
        // PCM16 mono at 24 kHz is exactly 48 bytes per millisecond.
        sentAudioMs += chunk.length / 48;
        // Binary frame, exactly as the service sent it.
        if (browser.readyState === browser.OPEN) {
          browser.send(chunk, { binary: true });
        }
      },

      // Azure path only: with Sarvam there is no synthesised audio here, so no
      // transcript event fires and captions come from onResponseTextDone.
      onResponseAudioTranscriptDone: async (event) => {
        if (USE_SARVAM) return;
        const text = event.transcript?.trim();
        if (text) {
          log(`says: ${text}`);
          send({ type: "captionText", text });
          void characters.appendTurn(conversationId, { role: "assistant", text });
        }
      },

      // Sarvam path: synthesise as the text streams in, sentence by sentence,
      // so the first sound does not wait for the whole reply.
      onResponseTextDelta: async (event) => {
        if (!USE_SARVAM || !event.delta) return;
        sentenceBuffer += event.delta;
        flushSentences(false);
      },

      onResponseTextDone: async (event) => {
        if (!USE_SARVAM) return;
        const full = event.text?.trim();
        if (full) {
          log(`says: ${full}`);
          void characters.appendTurn(conversationId, { role: "assistant", text: full });
        }
        replyTextComplete = true;
        // Speak whatever is left, including a reply with no final punctuation.
        flushSentences(true);
        // A reply that produced no speech at all still has to end the turn.
        finishReply();
      },

      onResponseDone: async () => {
        responseActive = false;
        // On the Sarvam path the reply is only text at this point and nothing
        // has been spoken yet, so going idle here would end the turn early and
        // start the silence clock while the character is still talking.
        if (USE_SARVAM) return;
        send({ type: "state", state: "idle" });
        scheduleIdleProd();
      },

      onServerError: async (event) => {
        const message = event.error?.message ?? "unknown";
        log("server error:", message);
        send({ type: "error", message });
      },

      onDisconnected: async () => {
        log("voice live disconnected");
        send({ type: "state", state: "ended" });
        await cleanup("provider disconnected");
      },
    });

    await session.connect();
    await session.updateSession(
      buildSessionConfig({
        model: MODEL,
        voice: voiceName,
        sttLanguages: STT_LANGUAGES,
        instructions: character.instructions,
        textOnly: USE_SARVAM,
      }),
    );
    log(
      USE_SARVAM
        ? `session configured, sarvam ${SARVAM_VOICES[voiceGender]} (${voiceGender}), roast=${roastIntensity}`
        : `session configured, voice=${voiceName} (${voiceGender}), roast=${roastIntensity}`,
    );

    await replayHistory();
  };

  browser.on("message", async (data, isBinary) => {
    if (closed || !session) return;

    // Binary == microphone audio. Hot path, keep it cheap.
    if (isBinary) {
      try {
        await session.sendAudio(new Uint8Array(data));
      } catch (err) {
        if (DEBUG) log("sendAudio failed:", err?.message);
      }
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (message.type) {
      // Awakening: the character speaks first so the user does not have to
      // invent an opening question.
      //
      // We ask the model to produce the greeting rather than injecting a
      // pre-written line as assistant text. Injecting it meant the caption
      // showed one sentence while the audio spoke a different one.
      case "greet":
        try {
          // Greeting someone mid-conversation would be wrong, so once history has
          // been replayed the character picks up where it left off instead. This
          // is also the moment a reconnect stops feeling like a failure.
          const prompt =
            resumedHistory > 0
              ? "സംഭാഷണം ഇടയ്ക്ക് മുറിഞ്ഞു, ഇപ്പോൾ വീണ്ടും ബന്ധം കിട്ടി. ഒരു ചെറിയ വാചകത്തിൽ സംഭാഷണം തുടരുക — നേരത്തെ സംസാരിച്ച കാര്യം ഓർമ്മിപ്പിച്ചുകൊണ്ട്."
              : `ആരോ നിന്റെ ചിത്രത്തിന് മുന്നിൽ വന്നു. ഇതുപോലെ ഒരു ചെറിയ വാചകത്തിൽ അവരെ അഭിവാദ്യം ചെയ്യുക: "${character.openingLine}"`;

          await session.addConversationItem({
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          });
          await session.sendEvent({ type: "response.create" });
        } catch (err) {
          log("greet failed:", err?.message);
          // Not fatal: the user can still just start talking.
          send({ type: "captionText", text: character.openingLine });
        }
        break;

      // Typed question. Real feature, not just test scaffolding: if microphone
      // permission is refused, the conversation can still happen by text
      // through the same realtime session and the same voice.
      case "ask": {
        const text = typeof message.text === "string" ? message.text.trim().slice(0, 500) : "";
        if (!text) break;
        noteUserActivity();
        try {
          send({ type: "userTranscript", text });
          // Recorded here as well as for spoken input. The audio transcription
          // event only fires for speech, so without this a typed question was
          // absent from the transcript and a replayed session saw the character
          // answering a question nobody had asked.
          void characters.appendTurn(conversationId, { role: "user", text });
          await session.addConversationItem({
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          });
          await session.sendEvent({ type: "response.create" });
        } catch (err) {
          log("ask failed:", err?.message);
          send({ type: "error", message: "Could not send that question." });
        }
        break;
      }

      case "interrupt":
        noteUserActivity();
        stopSarvam();
        try {
          await session.sendEvent({ type: "response.cancel" });
        } catch {}
        send({ type: "interrupted" });
        break;

      /**
       * The browser reporting how much of a response it actually played, so we
       * can truncate the conversation item to match.
       *
       * Without this the model believes it said everything we streamed, even
       * though audio arrives faster than realtime and the user cut it off. Over
       * several interruptions its sense of the conversation drifts from reality.
       */
      case "played": {
        // Not applicable on the Sarvam path: Voice Live produced no audio item,
        // so there is nothing to truncate. Known tradeoff, see the README.
        if (USE_SARVAM) break;

        const itemId = typeof message.itemId === "string" ? message.itemId : null;
        if (!itemId || itemId !== currentItemId) break;

        // The service errors if asked to truncate past the real audio duration,
        // so clamp to what we actually sent.
        const heardMs = Math.max(0, Math.min(Math.round(message.ms ?? 0), Math.floor(sentAudioMs)));

        try {
          await session.sendEvent({
            type: "conversation.item.truncate",
            itemId,
            contentIndex: 0,
            audioEndInMs: heardMs,
          });
          if (DEBUG) log(`truncated ${itemId} at ${heardMs}ms of ${Math.floor(sentAudioMs)}ms`);
        } catch (err) {
          // Non-fatal: the conversation continues, just with slightly optimistic
          // context about what the user heard.
          log("truncate failed:", err?.message);
        }
        break;
      }

      // Signature interaction. The reaction is spoken by the live session, so
      // no pre-recorded audio and no generated video.
      case "escape":
        noteUserActivity();
        try {
          await session.addConversationItem({
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "നീ ഇപ്പോൾ ഫ്രെയിമിന് പുറത്ത് ചാടാൻ ശ്രമിച്ചു, പക്ഷേ ഫ്രെയിമിന്റെ അതിരിൽ ഇടിച്ചു. ആ വേദനയോടെ പ്രതികരിക്കുക.",
              },
            ],
          });
          await session.sendEvent({ type: "response.create" });
        } catch (err) {
          log("escape failed:", err?.message);
        }
        break;

      default:
        break;
    }
  });

  browser.on("close", () => cleanup("browser closed"));
  browser.on("error", (err) => cleanup(`browser error: ${err?.message}`));

  start().catch(async (err) => {
    log("startup failed:", err?.message ?? err);
    send({
      type: "error",
      message: `Could not start the realtime session: ${err?.message ?? err}`,
    });
    await cleanup("startup failed");
  });
});

httpServer.listen(PORT, () => {
  console.log(`Framinu Purathu server on http://localhost:${PORT}`);
  console.log(`  model  ${MODEL}`);
  console.log(`  tts    ${TTS_PROVIDER}`);
  console.log(
    USE_SARVAM
      ? `  voices ${SARVAM_VOICES.male} / ${SARVAM_VOICES.female} (bulbul:v3)`
      : `  voices ${VOICES.male} / ${VOICES.female}`,
  );
  console.log(`  vision ${visionModelName}   stt ${STT_LANGUAGES}`);
  console.log(`  cards  ${characters.backend}`);

  if (USE_SARVAM && !process.env.SARVAM_API_KEY) {
    console.warn("  [warn] TTS_PROVIDER=sarvam but SARVAM_API_KEY is missing; replies will be silent");
  }
});
