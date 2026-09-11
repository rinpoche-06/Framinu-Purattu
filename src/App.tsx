import { useCallback, useEffect, useRef, useState } from "react";
import { MouthEditor } from "./components/MouthEditor";
import { PictureStage, type AudioSource } from "./components/PictureStage";
import { UploadPanel } from "./components/UploadPanel";
import type { PreparedImage } from "./lib/imagePrep";
import { MicCapture } from "./lib/micCapture";
import { PcmPlayer, PLAYBACK_SAMPLE_RATE } from "./lib/pcmPlayer";
import { deriveEyes, type EyePlacement, type MouthPlacement } from "./lib/placement";
import { clearSnapshot, loadSnapshot, saveSnapshot } from "./lib/sessionSnapshot";
import {
  RealtimeLink,
  type RoastLevel,
  type SessionState,
  type VoiceChoice,
} from "./lib/realtime";

/** Landing -> prepare the picture -> talk to it. */
type Stage = "landing" | "preparing" | "talking";

interface CharacterCard {
  subjectType: string;
  subjectLabel: string;
  visibleDetails: string[];
  personality: string;
  grievance: string;
  openingLine: string;
  mouth: MouthPlacement;
  suggestedVoice: "male" | "female" | "either";
  recognisedWork?: { isKnown: boolean; title: string; creator: string };
}

/**
 * Identifies one sitting with one picture.
 *
 * Minted here rather than by the server, because it has to survive a page reload
 * and a server restart. The provider cannot resume a session, so this is what
 * lets the transcript be replayed back into a fresh one.
 */
function newConversationId(): string {
  return crypto.randomUUID();
}

interface Subject {
  /** Undefined for the built-in chair, which the server already knows. */
  characterId?: string;
  /** Stable across reconnects, so the character remembers the conversation. */
  conversationId: string;
  label: string;
  imageUrl: string;
  aspectRatio: number;
  mouth: MouthPlacement;
  eyes: EyePlacement;
  card?: CharacterCard;
}

const CHAIR_MOUTH: MouthPlacement = {
  x: 0.5,
  y: 0.42,
  width: 0.16,
  height: 0.075,
  rotation: 0,
};

function chairSubject(): Subject {
  return {
    conversationId: newConversationId(),
    label: "പഴയ പ്ലാസ്റ്റിക് കസേര",
    imageUrl: "/chair.svg",
    aspectRatio: 3 / 4,
    mouth: CHAIR_MOUTH,
    eyes: { x: 0.5, y: 0.278, spacing: 0.207, radius: 0.049, rotation: 0 },
  };
}

const STATE_LABELS: Record<SessionState, string> = {
  idle: "കാത്തിരിക്കുന്നു",
  connecting: "ബന്ധിപ്പിക്കുന്നു...",
  ready: "സംസാരിക്കാം",
  listening: "കേൾക്കുന്നു...",
  thinking: "ആലോചിക്കുന്നു...",
  speaking: "സംസാരിക്കുന്നു...",
  reconnecting: "വീണ്ടും ബന്ധിപ്പിക്കുന്നു...",
  error: "പ്രശ്നം",
  ended: "അവസാനിച്ചു",
};

/**
 * How long to keep the microphone closed after the character stops speaking.
 * Covers the room's reverb tail, which would otherwise be heard as the user
 * starting to talk.
 */
const SPEAKING_GUARD_TAIL_MS = 350;

const SUGGESTIONS = [
  "നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ?",
  "എന്നെക്കുറിച്ച് നിന്റെ അഭിപ്രായം എന്താ?",
  "ഫ്രെയിമിന് പുറത്ത് പോയാൽ എന്ത് ചെയ്യും?",
];

export default function App() {
  const [stage, setStage] = useState<Stage>("landing");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisNote, setAnalysisNote] = useState("");

  const [state, setState] = useState<SessionState>("idle");
  const [caption, setCaption] = useState("");
  const [userSaid, setUserSaid] = useState("");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [escaping, setEscaping] = useState(false);
  const [live, setLive] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [typed, setTyped] = useState("");
  const [voice, setVoice] = useState<VoiceChoice>("male");
  const [roast, setRoast] = useState<RoastLevel>("savage");
  const [showEyes, setShowEyes] = useState(true);
  /** Set when the picture came back from a reload, so we can say so. */
  const [resumed, setResumed] = useState(false);
  /**
   * Push-to-talk by default. Presenting through speakers without headphones
   * means the microphone hears the character and the audience, and hands-free
   * would have it interrupting itself and answering laughter.
   */
  const [pushToTalk, setPushToTalk] = useState(true);
  const [transmitting, setTransmitting] = useState(false);

  /** Read inside the animation loop, so it must be a ref rather than state. */
  const holdingRef = useRef(false);
  /** Last moment the character was audibly speaking, for the guard tail. */
  const lastSpokeAtRef = useRef(0);
  /** Mirrors what we last told the mic, to avoid redundant calls every frame. */
  const micMutedRef = useRef(true);
  const pushToTalkRef = useRef(pushToTalk);
  pushToTalkRef.current = pushToTalk;
  const userMutedRef = useRef(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const linkRef = useRef<RealtimeLink | null>(null);
  const frameRef = useRef<number | null>(null);
  /** Assistant item currently speaking, needed to address truncation. */
  const speakingItemRef = useRef<string | null>(null);

  /**
   * Stable accessor handed to the stage, which runs its own animation loop.
   * Per-frame values never enter React state: they would trigger a re-render
   * sixty times a second for data nothing else reads.
   */
  const audioSource = useRef<AudioSource>({
    getLevel: () => playerRef.current?.readLevel() ?? 0,
    isPlaying: () => playerRef.current?.isPlaying ?? false,
  }).current;

  /** Tear down every audio and network resource. Safe to call repeatedly. */
  const teardown = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    linkRef.current?.close();
    linkRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.clear();
    playerRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;

    holdingRef.current = false;
    micMutedRef.current = true;
    setTransmitting(false);
    setLive(false);
  }, []);

  useEffect(() => teardown, [teardown]);

  // Restore the picture after a reload. Deliberately stops at the prepare screen
  // rather than reconnecting automatically: a session that starts talking on its
  // own after a refresh would be alarming, and waking it is one tap.
  useEffect(() => {
    const snapshot = loadSnapshot();
    if (!snapshot) return;

    setSubject({
      characterId: snapshot.characterId,
      // Reusing the stored id is what lets the character remember what was said
      // before the reload, not just which picture it was.
      conversationId: snapshot.conversationId ?? newConversationId(),
      label: snapshot.label,
      imageUrl: snapshot.imageUrl,
      aspectRatio: snapshot.aspectRatio,
      mouth: snapshot.mouth,
      eyes: snapshot.eyes,
      card: snapshot.card as Subject["card"],
    });
    setShowEyes(snapshot.showEyes);
    setVoice(snapshot.voice);
    setRoast(snapshot.roast);
    setStage("preparing");
    setResumed(true);
  }, []);

  // Persist whenever anything the prepare screen owns changes. Cheap: a few
  // hundred KB of JSON, written only on discrete user actions.
  useEffect(() => {
    if (!subject) return;
    saveSnapshot({
      characterId: subject.characterId,
      conversationId: subject.conversationId,
      label: subject.label,
      imageUrl: subject.imageUrl,
      aspectRatio: subject.aspectRatio,
      mouth: subject.mouth,
      eyes: subject.eyes,
      showEyes,
      voice,
      roast,
      card: subject.card,
    });
  }, [subject, showEyes, voice, roast]);

  const analyse = useCallback(async (image: PreparedImage) => {
    setAnalysing(true);
    setAnalysisNote("");
    setError("");
    setResumed(false);

    try {
      const response = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: image.dataUrl }),
      });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");

      const card = payload.card as CharacterCard;
      // "either" means the model deliberately did not guess, which is the case
      // for objects and for ordinary photos of people. Only a recognised work
      // with a documented subject moves the toggle for you.
      setVoice(card.suggestedVoice === "female" ? "female" : "male");
      setSubject({
        characterId: payload.id,
        conversationId: newConversationId(),
        label: card.subjectLabel,
        imageUrl: image.dataUrl,
        aspectRatio: image.aspectRatio,
        mouth: card.mouth,
        eyes: deriveEyes(card.mouth),
        card,
      });
      if (payload.warnings?.length) {
        setAnalysisNote("Some details were unclear, so parts of the character were guessed.");
      }
      setStage("preparing");
    } catch (err) {
      // Analysis failing must not be a dead end: fall back to a manual
      // character so the user can still have a conversation.
      const message = err instanceof Error ? err.message : String(err);
      setError(`${message} You can still continue and describe the subject yourself.`);
      const fallbackMouth: MouthPlacement = {
        x: 0.5,
        y: 0.6,
        width: 0.18,
        height: 0.08,
        rotation: 0,
      };
      setSubject({
        conversationId: newConversationId(),
        label: "ഈ ചിത്രത്തിലെ സാധനം",
        imageUrl: image.dataUrl,
        aspectRatio: image.aspectRatio,
        mouth: fallbackMouth,
        eyes: deriveEyes(fallbackMouth),
      });
      setStage("preparing");
    } finally {
      setAnalysing(false);
    }
  }, []);

  const useChair = useCallback(() => {
    setError("");
    setAnalysisNote("");
    setResumed(false);
    setSubject(chairSubject());
    setStage("preparing");
  }, []);

  const setMouth = useCallback((mouth: MouthPlacement) => {
    setSubject((current) => (current ? { ...current, mouth } : current));
  }, []);

  const setEyes = useCallback((eyes: EyePlacement) => {
    setSubject((current) => (current ? { ...current, eyes } : current));
  }, []);

  const start = useCallback(async () => {
    if (live || !subject) return;
    setError("");
    setCaption("");
    setUserSaid("");
    setState("connecting");
    setStage("talking");

    try {
      // 24 kHz matches what Voice Live sends and expects, so the browser
      // resamples the microphone and playback needs no conversion.
      const ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
      await ctx.resume();
      ctxRef.current = ctx;

      const player = new PcmPlayer(ctx);
      playerRef.current = player;

      /**
       * Hand the card back to a server that has forgotten it, then reconnect
       * with the new id. The demo chair needs no restore: it is built into the
       * server rather than stored per upload.
       */
      const restoreCharacter = async () => {
        const card = subject.card;
        if (!card) return;
        try {
          const response = await fetch("/api/character/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ card }),
          });
          const payload = await response.json();
          if (!response.ok || !payload.id) throw new Error(payload.error ?? "restore failed");

          setSubject((current) =>
            current ? { ...current, characterId: payload.id } : current,
          );
          linkRef.current?.reconnectAs(payload.id);
        } catch {
          setError(
            "The server restarted and lost this picture's character. Press Stop and wake it again.",
          );
        }
      };

      const link = new RealtimeLink({
        onAudio: (pcm) => player.enqueue(pcm),
        onMessage: (message) => {
          switch (message.type) {
            case "state":
              // Do not let a server "idle" override audio still draining out of
              // the local queue.
              if (message.state === "idle" && player.isPlaying) return;
              setState(message.state);
              break;
            case "captionText":
              setCaption(message.text);
              break;
            case "userTranscript":
              setUserSaid(message.text);
              break;
            case "responseStart":
              // Played duration is tracked per response, for truncation.
              speakingItemRef.current = message.itemId;
              player.beginResponse();
              break;
            case "interrupted": {
              // Report how much was actually heard BEFORE clearing, since
              // clear() resets the counters. The server truncates the item to
              // match, so the model does not think it said the rest.
              const itemId = speakingItemRef.current;
              if (itemId) {
                link.send({
                  type: "played",
                  itemId,
                  ms: Math.round(player.playedSeconds * 1000),
                });
              }
              // Drop queued audio. The mouth closes on its own, because the
              // level it follows goes to zero.
              player.clear();
              break;
            }
            case "characterMissing":
              // The server restarted and lost the card. We still have it, so
              // hand it back and reconnect rather than quietly continuing as
              // the demo chair.
              void restoreCharacter();
              break;
            case "error":
              setError(message.message);
              setState("error");
              break;
          }
        },
        onReconnecting: (attempt, delayMs) => {
          setState("reconnecting");
          // Whatever was mid-sentence will never finish, so drop it and shut
          // the mouth instead of leaving it frozen mid-word.
          player.clear();
          setError(
            `Connection dropped. Retrying in ${Math.round(delayMs / 1000) || 1}s (attempt ${attempt}).`,
          );
        },
        onReconnected: () => {
          setError("");
          setState("ready");
          // Worth saying plainly: the provider gives us a fresh session, so the
          // character is itself again but has forgotten the conversation.
          setCaption("");
          setUserSaid("");
        },
        onClosed: () => {
          setState("ended");
          teardown();
        },
      });
      linkRef.current = link;
      link.connect(subject.characterId, voice, roast, subject.conversationId);

      // A refused microphone should not end the experience. The realtime
      // session accepts typed input through the same voice, so we degrade to
      // text rather than pretending voice mode is working.
      try {
        const mic = new MicCapture(ctx, (frame) => link.sendAudio(frame));
        micRef.current = mic;
        await mic.start();

        // The microphone starts live, so apply the gate immediately rather than
        // waiting for the loop to notice. Otherwise push-to-talk would transmit
        // from the moment the session opens, which is exactly what it exists to
        // prevent.
        holdingRef.current = false;
        userMutedRef.current = false;
        lastSpokeAtRef.current = performance.now();
        micMutedRef.current = true;
        mic.setMuted(true);
        setTransmitting(false);

        setTextOnly(false);
      } catch {
        micRef.current = null;
        setTextOnly(true);
        setError(
          "Microphone blocked, so voice input is off. You can still type questions below and it will answer out loud.",
        );
      }

      setLive(true);

      // Derives the discrete "is it speaking" state and gates the microphone.
      // Returning the same value from a setState updater bails out without
      // re-rendering, so this costs nothing on frames where nothing changed.
      const tick = () => {
        const playing = player.isPlaying;
        const now = performance.now();
        if (playing) lastSpokeAtRef.current = now;

        setState((current) => {
          if (current === "error" || current === "ended") return current;
          if (playing) return "speaking";
          if (current === "speaking") return "ready";
          return current;
        });

        // Speaking guard: never listen while the character talks, plus a short
        // tail for room reverb. Without this, playing through speakers makes it
        // hear itself, interrupt itself, and answer its own voice. Azure's
        // server-side echo cancellation is unavailable on the Sarvam path, so
        // this is the only thing standing between us and a feedback loop.
        const guarded = playing || now - lastSpokeAtRef.current < SPEAKING_GUARD_TAIL_MS;
        const gatedByPtt = pushToTalkRef.current && !holdingRef.current;
        const shouldMute = userMutedRef.current || guarded || gatedByPtt;

        if (shouldMute !== micMutedRef.current) {
          micMutedRef.current = shouldMute;
          micRef.current?.setMuted(shouldMute);
          setTransmitting(!shouldMute);
        }

        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);

      // The character speaks first, so nobody is left inventing an opening
      // question at a silent picture.
      setTimeout(() => link.send({ type: "greet" }), 900);
    } catch (err) {
      // Only reached if audio or the socket itself failed, since a refused
      // microphone is handled above and falls back to text.
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
      teardown();
      setStage("preparing");
    }
  }, [live, subject, teardown, voice, roast]);

  const askTyped = useCallback(() => {
    const text = typed.trim();
    if (!text || !live) return;
    linkRef.current?.send({ type: "ask", text });
    setTyped("");
  }, [typed, live]);

  const stop = useCallback(() => {
    teardown();
    setState("idle");
    setStage("preparing");
  }, [teardown]);

  const changePicture = useCallback(() => {
    teardown();
    setState("idle");
    // Deliberate discard, so the old picture does not reappear on the next
    // reload after the user has moved on from it.
    clearSnapshot();
    setResumed(false);
    setSubject(null);
    setCaption("");
    setUserSaid("");
    setError("");
    setAnalysisNote("");
    setStage("landing");
  }, [teardown]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    // The animation loop owns the mic gate, so we only record intent here and
    // let it apply the combination of user mute, speaking guard and push-to-talk.
    userMutedRef.current = next;
  }, [muted]);

  const setHolding = useCallback((holding: boolean) => {
    holdingRef.current = holding;
  }, []);

  // Space bar as the push-to-talk key, so you are not chasing a button with the
  // mouse while presenting. Ignored while typing in the question box.
  useEffect(() => {
    if (!live || !pushToTalk) return;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      // Must come before the repeat check. Holding space fires repeated keydown
      // events, and letting those through scrolled the page and pushed the
      // picture out of view mid-conversation.
      event.preventDefault();
      if (event.repeat) return;
      holdingRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      event.preventDefault();
      holdingRef.current = false;
    };
    // Losing focus mid-hold would otherwise leave the microphone open.
    const onBlur = () => {
      holdingRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [live, pushToTalk]);

  const escape = useCallback(() => {
    if (!live) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      setEscaping(true);
      setTimeout(() => setEscaping(false), 900);
    }
    linkRef.current?.send({ type: "escape" });
  }, [live]);

  return (
    <main className="app">
      <header className="masthead">
        <h1>
          ഫ്രെയിമിന് പുറത്ത്
          <span className="masthead-latin">Framinu Purathu</span>
        </h1>
        <p className="tagline">
          Every picture has a story. Unfortunately, it also has an attitude.
        </p>
      </header>

      {stage === "landing" && (
        <>
          <p className="pitch">
            ഒരു ചിത്രം എടുക്കൂ. അതിലുള്ളത് സംസാരിക്കാൻ തുടങ്ങും. പരാതിയോടെ.
          </p>
          {analysing ? (
            <div className="analysing">
              <span className="spinner" />
              ചിത്രം നോക്കുന്നു... reading your picture
            </div>
          ) : (
            <UploadPanel onImage={analyse} onUseChair={useChair} disabled={analysing} />
          )}
        </>
      )}

      {stage === "preparing" && subject && (
        <>
          {resumed && (
            <p className="resumed-note">
              നിന്റെ ചിത്രം ഓർത്തുവെച്ചു · Picked up where you left off. Press
              wake, or choose a different picture.
            </p>
          )}
          <MouthEditor
            imageUrl={subject.imageUrl}
            aspectRatio={subject.aspectRatio}
            mouth={subject.mouth}
            eyes={showEyes ? subject.eyes : null}
            onMouthChange={setMouth}
            onEyesChange={setEyes}
          />

          <label className="eyes-toggle">
            <input
              type="checkbox"
              checked={showEyes}
              onChange={(event) => setShowEyes(event.target.checked)}
            />
            കാർട്ടൂൺ കണ്ണുകൾ · Cartoon eyes
            <span>turn off if the picture already has eyes you want to keep</span>
          </label>

          {subject.card && (
            <div className="card-preview">
              <strong>{subject.card.subjectLabel}</strong>
              {subject.card.recognisedWork?.isKnown &&
                subject.card.recognisedWork.creator && (
                  <span className="recognised">
                    {subject.card.recognisedWork.title} ·{" "}
                    {subject.card.recognisedWork.creator}
                  </span>
                )}
              <span>{subject.card.personality}</span>
              <em>{subject.card.grievance}</em>
            </div>
          )}

          <fieldset className="voice-picker">
            <legend>ശബ്ദം · Voice</legend>
            <div className="voice-options">
              <label className={voice === "male" ? "selected" : undefined}>
                <input
                  type="radio"
                  name="voice"
                  checked={voice === "male"}
                  onChange={() => setVoice("male")}
                />
                പുരുഷ ശബ്ദം
              </label>
              <label className={voice === "female" ? "selected" : undefined}>
                <input
                  type="radio"
                  name="voice"
                  checked={voice === "female"}
                  onChange={() => setVoice("female")}
                />
                സ്ത്രീ ശബ്ദം
              </label>
            </div>
            <p className="voice-hint">
              {subject.card?.suggestedVoice === "either" || !subject.card
                ? "Pick whichever suits your picture."
                : "Pre-selected from the artwork, but change it if you disagree."}
            </p>
          </fieldset>

          <fieldset className="voice-picker">
            <legend>കളിയാക്കൽ · Roast level</legend>
            <div className="voice-options">
              <label className={roast === "savage" ? "selected" : undefined}>
                <input
                  type="radio"
                  name="roast"
                  checked={roast === "savage"}
                  onChange={() => setRoast("savage")}
                />
                Savage
              </label>
              <label className={roast === "normal" ? "selected" : undefined}>
                <input
                  type="radio"
                  name="roast"
                  checked={roast === "normal"}
                  onChange={() => setRoast("normal")}
                />
                Normal
              </label>
            </div>
            <p className="voice-hint">
              {roast === "savage"
                ? "Insults you in nearly every reply. It still answers the question, and never goes after your appearance or identity."
                : "Teases you about every other reply, with warmer moments in between."}
            </p>
          </fieldset>

          {analysisNote && <p className="note">{analysisNote}</p>}

          <div className="controls">
            <button className="btn btn-primary" onClick={start}>
              ജീവൻ കൊടുക്കൂ · Wake it up
            </button>
            <button className="btn btn-quiet" onClick={changePicture}>
              വേറെ ചിത്രം · Change picture
            </button>
          </div>
        </>
      )}

      {stage === "talking" && subject && (
        <>
          <PictureStage
            imageUrl={subject.imageUrl}
            label={subject.label}
            aspectRatio={subject.aspectRatio}
            mouth={subject.mouth}
            eyes={showEyes ? subject.eyes : null}
            escaping={escaping}
            sessionState={state}
            audio={audioSource}
          />

          <div className={`status status-${state}`}>
            <span className="status-dot" />
            {STATE_LABELS[state]}
          </div>

          <div className="captions" aria-live="polite">
            {userSaid && <p className="caption-user">നീ: {userSaid}</p>}
            {caption && <p className="caption-chair">{caption}</p>}
            {!userSaid && !caption && live && (
              <p className="caption-hint">എന്തെങ്കിലും ചോദിക്കൂ...</p>
            )}
          </div>

          {!textOnly && pushToTalk && (
            <button
              className={`talk-btn${transmitting ? " talk-btn-live" : ""}`}
              onPointerDown={() => setHolding(true)}
              onPointerUp={() => setHolding(false)}
              onPointerLeave={() => setHolding(false)}
              onPointerCancel={() => setHolding(false)}
              // The pointer handlers already cover this; the space bar is wired
              // globally so it works without focusing the button.
              onContextMenu={(event) => event.preventDefault()}
            >
              {transmitting ? "കേൾക്കുന്നു... release when done" : "പിടിച്ച് സംസാരിക്കൂ · Hold to talk"}
              <span>or hold the space bar</span>
            </button>
          )}

          {!textOnly && (
            <label className="ptt-toggle">
              <input
                type="checkbox"
                checked={pushToTalk}
                onChange={(event) => {
                  setPushToTalk(event.target.checked);
                  holdingRef.current = false;
                }}
              />
              Push to talk
              <span>
                {pushToTalk
                  ? "safest with speakers: it only hears you while you hold"
                  : "hands-free. Use headphones, or it will hear itself"}
              </span>
            </label>
          )}

          <div className="controls">
            {!textOnly && !pushToTalk && (
              <button className="btn" onClick={toggleMute}>
                {muted ? "Unmute" : "Mute mic"}
              </button>
            )}
            <button className="btn btn-escape" onClick={escape}>
              പുറത്ത് ചാടാൻ നോക്കൂ · Escape
            </button>
            <button className="btn btn-quiet" onClick={stop}>
              Stop
            </button>
            <button className="btn btn-quiet" onClick={changePicture}>
              വേറെ ചിത്രം
            </button>
          </div>

          {live && (
            <form
              className="ask-row"
              onSubmit={(event) => {
                event.preventDefault();
                askTyped();
              }}
            >
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={
                  textOnly ? "ചോദ്യം ടൈപ്പ് ചെയ്യൂ..." : "or type a question..."
                }
                aria-label="Type a question"
                maxLength={500}
              />
              <button className="btn" type="submit" disabled={!typed.trim()}>
                ചോദിക്കൂ
              </button>
            </form>
          )}

          {live && (
            <div className="suggestions">
              <span>ചോദിക്കാൻ:</span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="suggestion-btn"
                  onClick={() => linkRef.current?.send({ type: "ask", text: s })}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {error && <div className="error">{error}</div>}

      <footer className="footnote">
        <p>
          {pushToTalk
            ? "Hold the button or the space bar, speak, then let go."
            : "Speak and it replies. Hands-free works best with headphones."}
        </p>
        {/*
          Kept, but collapsed. The wall of text crowded the picture on the demo
          screen, and the picture is supposed to be the focus. Folding it away
          keeps the disclosure available without it dominating the page.
        */}
        <details className="notice">
          <summary>Privacy and AI notice</summary>
          <p>
            Your image and microphone audio are sent to the configured AI
            providers to generate replies. Nothing is stored. The voice is a
            stock synthetic voice and the personality is fiction, not a real
            recording of anyone. The mouth is animated from audio loudness, so it
            moves in time with speech but does not form accurate lip shapes.
          </p>
        </details>
      </footer>
    </main>
  );
}
