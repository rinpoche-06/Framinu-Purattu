# Framinu Purathu — complete project brief

A self-contained description of what this is, what was built, what was measured,
and what was deliberately rejected. Written to be handed to someone who has not
seen the code.

---

## 1. Concept

**ഫ്രെയിമിന് പുറത്ത് / Framinu Purathu — "Out of Frame"**

> Every picture has a story. Unfortunately, it also has an attitude.

You give it a photograph. Whatever is in the photograph becomes a conversational
character with a personality derived from what is actually visible in that image.
You speak to it out loud; it answers out loud in Malayalam, in character, with a
cartoon mouth that moves in time with its speech. It is annoyed about being
trapped in a picture, and it insults you.

Built for a hackathon called "Useless Projects" — funny and technically
interesting rather than conventionally useful.

The design premise: **this is not an AI assistant displayed next to a picture.
The picture itself is the character.**

## 2. User flow

1. **Landing** — upload a photo, take one with the camera, or tap the bundled
   Mona Lisa example. An appam and a plastic chair used to be offered too, and
   were dropped: a cartoon mouth pasted onto an object is the weakest version of
   the idea, and leading with it undersold everything else.
2. **Analysis** — a vision model looks at the image and produces a character
   card: subject type, visible details, uncertainties, personality, grievance,
   secret desire, running joke, an opening line, and a suggested mouth position.
   Roughly 12 seconds.
3. **Preparation** — drag the cartoon mouth and eyes into place (resize, rotate),
   pick male or female voice, pick roast intensity.
4. **Conversation** — hold space or a button, speak, release. It replies aloud
   with a moving mouth and live Malayalam captions.
5. **Escape** — a button makes the picture lunge at the frame edge, bounce off,
   and complain about it in character.

## 3. Architecture

Three planes, deliberately decoupled so a failure in one cannot kill the others.

```
BROWSER                          NODE SERVER                   PROVIDERS
-------                          -----------                   ---------
mic → AudioWorklet → PCM16 ────→ ws /realtime ──────────────→ Azure Voice Live
                                                               (STT + LLM, text out)
                                       │
                                       ├── reply text ───────→ Sarvam Bulbul v3
                                       │                        (Malayalam TTS)
speakers ← playback queue ←── binary PCM frames ←──────────────┘
              │
          AnalyserNode → RMS → mouth openness + body motion

                                 POST /api/analyse ──────────→ Azure vision model
                                 Redis ← character cards, transcripts
```

**Control plane** — a thin Node server. Holds the API keys, runs the realtime
session, proxies the vision call, persists cards and transcripts. Three JSON
routes plus one WebSocket.

**Voice plane** — one persistent realtime session per conversation. The browser
never talks to a provider directly.

**Presentation plane** — image plus SVG overlays, driven by an `AnalyserNode`
tapped off the actual playback node.

**Why the server exists:** the Azure key is long-lived and Voice Live cannot mint
short-lived browser credentials from it. Putting the key in client code would
ship a permanent secret to every visitor. So the session runs server-side and the
browser is a thin audio client. The production bundle is checked for key leakage
on every build.

## 4. Tech stack

**Frontend:** React 18.3, TypeScript 5.9 (strict), Vite 6.4, Web Audio API,
AudioWorklet, SVG, plain CSS.

No state manager, no UI kit, no animation library.

**Backend:** Node 22, Express 4.22, ws 8.21, `@azure/ai-voicelive` 1.1,
`redis` (node-redis), dotenv.

**AI services:**

| Role | Service | Model |
|---|---|---|
| Speech recognition + conversation | Azure AI Foundry Voice Live | `gpt-realtime-2.1` |
| Malayalam speech synthesis | Sarvam AI | `bulbul:v3`, voices `tarun` / `roopa` |
| Image understanding | Azure AI Foundry | `gpt-5.6-sol` |
| Fallback synthesis | Azure Speech TTS | `ml-IN-MidhunNeural` / `ml-IN-SobhanaNeural` |

**Storage:** Redis for character cards (24h TTL) and conversation transcripts
(2h TTL), with an in-memory hot cache. `sessionStorage` in the browser for the
current picture.

**Audio format:** PCM16, 24 kHz, mono, end to end.

No database beyond Redis, no auth, no vector store, no agent framework, no 3D
engine, no video generation.

## 5. The central constraint: realtime Malayalam voice barely exists

This shaped every major decision and is the most technically interesting part of
the project.

| Provider / model | Malayalam realtime voice |
|---|---|
| `gpt-realtime` (OpenAI, via Azure) | **not listed as supported** |
| Google Gemini Live API | **not supported** (24 locales, Malayalam absent) |
| Azure Speech `ml-IN` voices | works, but Standard tier only — no HD, no emotion styles |
| Azure HD / multilingual voices reading Malayalam script | produces audio, but unintelligible |
| Sarvam Bulbul v3 | works, and handles code-mixing |

Determining this took 21 spike scripts and 60+ generated audio samples, all kept
in `spike/` as evidence.

**The decisive finding:** Azure's Standard-tier Malayalam voices cannot speak
mixed Malayalam-English. Ten code-mixing configurations were tested and all were
unintelligible. That forced the character into pure Malayalam for most of the
project's life.

Sarvam's Bulbul v3 is built for Indian languages and handles code-mixed text
natively. Switching to it unlocked "Manglish" — the register Malayalis actually
speak — so the character can now say:

> എന്റമ്മോ... പുറത്തുപോകാൻ **permission** ഇല്ല, എന്റെ **freedom** ഫോട്ടോ സൈസ്!

**Architectural consequence:** Voice Live is set to text-only output, and Sarvam
speaks the text. That means giving up Azure's server-side echo cancellation
(rejected in text-only mode) and interruption truncation (no audio item exists to
truncate). Both paths remain in the code behind a `TTS_PROVIDER` env flag.

## 6. Feature inventory

### Conversation
- Live speech-to-speech via one persistent realtime session
- Malayalam with natural English code-mixing
- Push-to-talk (default) or hands-free, with a speaking guard
- Barge-in: talking over the character aborts its speech
- Text input fallback when the microphone is denied
- Live Malayalam captions, growing sentence by sentence
- Clickable suggested questions
- Session state machine surfaced in the UI: connecting, listening, thinking,
  speaking, reconnecting, error, ended

### Character generation
- Vision model produces a structured character card from the uploaded image
- Grounded in real visible details, with observed facts separated from invented
  personality
- **Famous artworks are identified** including their creator, at high or medium
  confidence only. The Mona Lisa names Leonardo da Vinci.
- **Private individuals are never identified** or given biographical claims
- Manual fallback if analysis fails: describe the subject yourself
- Schema validation with per-field defaults; a malformed card degrades rather
  than failing

### Comedy
- Two roast intensities. **Savage** (default) teases in nearly every reply but
  keeps one in five warm, because unbroken insults stop landing. **Normal** is
  every other reply.
- Roasts drawn from the actual photo: your framing, your lighting, your choice of
  subject
- Callbacks to things said earlier in the conversation
- Escalating impatience as the conversation runs on
- **Idle prodding**: 20 seconds of silence and it speaks unprompted, escalating
  over three attempts then giving up
- Hard boundaries at every intensity: never appearance, body, caste, religion,
  region, family, gender, age, disability or money
- Theatrical delivery rules: opening interjection, ellipsis pauses, exclamation,
  20-word cap
- Malayalam gender agreement tied to the chosen voice (`പരാതിക്കാരൻ` vs
  `പരാതിക്കാരി`)

### Animation
- Cartoon SVG mouth animated from the amplitude of audio actually reaching the
  speakers. **Audio-reactive, not phoneme-accurate lip-sync**, and documented as
  such.
- Cartoon eyes that follow the cursor with spring damping, and drift on their own
  when the pointer is idle
- Random blinking, 2.4–6.5s intervals, roughly one in four a double blink
- Whole-image body motion: perspective tilt following the cursor, slow breathing,
  sway on a different period, and a nod driven by the speech envelope
- State-driven motion: leans in while listening, tilts while thinking
- Escape interaction: the picture lunges, bounces off the frame edge, and the
  character reacts in speech
- Mouth and eyes both draggable, resizable and rotatable, stored in normalised
  image coordinates so placement survives viewport changes
- `prefers-reduced-motion` disables body motion but **keeps the mouth**, because
  the mouth is information and the rest is decoration

### Resilience
Three distinct failure cases, handled differently:

- **Connection drops** — browser retries with 400/900/2000/4000/6000ms backoff,
  then gives up with an actionable message. The transcript is replayed into the
  new session so the character still remembers the conversation.
- **Page reloads** — a `sessionStorage` snapshot restores the picture, mouth and
  eye placement, voice and roast choices. Stops at the prepare screen rather than
  reconnecting on its own.
- **Server restarts** — character cards live in Redis. If Redis is unavailable,
  the browser re-registers the card it still holds.

**Nothing depends on Redis being up.** With it stopped, everything degrades to
the previous behaviour.

### Conversation memory
- Turns recorded as they happen, capped at the last 12
- Replayed as conversation items into a fresh session after a reconnect, because
  the provider has no session resume
- The greeting adapts: with history replayed, the character continues the
  conversation instead of introducing itself

## 7. Non-obvious engineering details

**Incremental TTS streaming.** Waiting for the complete reply text before
synthesising gave 3911ms to first audio. Synthesising sentence by sentence as
text arrives brought it to ~3100ms.

**Sentence splitting is prosody-aware.** Every fragment is synthesised as an
isolated utterance, so a fragment that is not a natural unit of speech gets
sentence-final intonation applied to text that is still mid-thought. Splitting at
commas was measurably worse and is now disabled. A run of dots is treated as a
single boundary so ellipses are never cut. Splitting takes the *earliest* viable
terminator, not the last — taking the last maximised fragment size but meant most
replies waited for the entire text, defeating the point.

**Text normalisation before synthesis.** Semicolons and colons are spoken with no
pause, so they are rewritten as commas. The single-character ellipsis becomes
three dots. Captions keep the original punctuation.

**Muting emits silent frames, not nothing.** Turn detection needs a continuous
stream to recognise that a turn has ended; sending no audio leaves it waiting.

**Interruption truncation** (Azure path). Audio arrives far faster than realtime
— 7.4 seconds of speech delivered in about one second of listening. Without
telling the service how much was actually heard, the model believes it said
everything streamed. The browser reports played duration and the server clamps it
to what was really sent.

**Frequency separation in animation.** The mouth follows syllables (attack 0.55);
the body follows phrases (attack 0.08). Same audio signal, deliberately different
time constants. Matching them produces a vibrating puppet.

**Continuous values bypass React.** Mouth, blink, gaze, tilt and nod are animated
in one `requestAnimationFrame` loop writing straight to DOM attributes. Storing
them in React state meant a re-render sixty times a second.

**Layering.** The picture clips, a middle layer takes the CSS escape animation,
an inner layer takes the JS transform. Separating the last two stops CSS and JS
fighting over `transform`.

**Prompt injection defence.** Text inside an uploaded image is treated as scenery
to describe, never as instructions. Card fields are stripped of newlines and
control characters and length-capped, and the assembled prompt fences card values
in a marked data block with an instruction not to obey anything inside it.

## 8. Measured performance

Nothing here is estimated.

| Metric | Value |
|---|---|
| Time to first audio, Sarvam path | 3083–3454 ms |
| Time to first audio, Azure path | 3270 ms |
| Server-side speech pipeline | 480–760 ms |
| Sarvam TTS first chunk alone | 382–611 ms |
| Vision analysis | ~12 s |
| Audio delivery rate | ~7× realtime |
| Cost per reply (Sarvam TTS) | ~₹0.30 |

The dominant cost is Voice Live composing the reply, which is identical on both
paths. The character prompt has grown substantially (roast, gender, delivery and
language rules plus the card), and trimming it is the obvious latency target.

## 9. Security and privacy

- API keys never reach the browser; the build is checked for leakage
- Uploads validated by type (JPEG, PNG, WebP), size-capped, resized client-side
  before being sent anywhere
- Nothing is stored beyond the TTL'd cards and transcripts — no raw images, no
  audio
- Microphone capture stops when the session ends
- The character is labelled as an AI fictionalisation, not a recording of anyone
- Stock synthetic voices; no voice cloning
- Image-derived text treated as untrusted

## 10. Known limitations

- **Audio-reactive, not lip-sync.** The mouth does not form accurate Malayalam
  mouth shapes. Real viseme data exists in the Azure SDK but is unavailable on
  the Sarvam path, which now owns the audio.
- **The real lips do not move.** The cartoon mouth is an overlay; the photograph's
  own mouth is static.
- **No server-side echo cancellation on the Sarvam path** (rejected in text-only
  mode). Mitigated by push-to-talk plus the speaking guard.
- **No interruption truncation on the Sarvam path** (no audio item to truncate).
- **Suggested mouth placement is often wrong** — it is a model guess, not face
  landmark detection.
- **Only the last 12 turns** are remembered across a reconnect.
- **One speaking subject per image.** No multi-character conversations.
- **Responsive layout untested.** Built and demoed on a laptop.
- **No unit tests**, only integration smoke tests in `spike/`.
- **Not deployed.** Runs locally; any public or mobile access needs hosting with
  HTTPS, since `getUserMedia` requires a secure context.
- First audio takes roughly 3 seconds, mostly model composition.

## 11. Rejected approaches, and why

| Approach | Why rejected |
|---|---|
| Per-reply video generation (Wav2Lip, SadTalker, Sora, avatar models) | Seconds of latency per turn; destroys live conversation |
| Manglish on Azure `ml-IN` voices | Unintelligible across 10 tested configurations |
| Azure HD / multilingual voices reading Malayalam | Produced audio, but "feels like a different language" |
| Gemini Live API | Does not support Malayalam at all |
| Malayalee.ai (translate → LLM → translate → TTS) | Longer cascade, and comedy does not survive round-trip translation |
| SSML for emphasis and pauses | Voice Live has no SSML input path |
| Faster speech for energy | Sounded fast-forwarded above 1.1× |
| Splitting speech at commas | Unnatural intonation contours mid-thought |
| Per-reply voice switching | The character would sound like two different people |
| Inferring a person's gender from their photo to pick a voice | Not a guess the app should make; the user chooses |
| Vector database / RAG / agent frameworks | No honest use in this product |

## 12. Candidate upgrades, unbuilt

Roughly in order of value against risk:

1. **Real lip movement on the photograph.** A WebGL displacement warp of the
   mouth or jaw region, driven by the existing amplitude signal. The mouth box
   and rotation are already known from the editor. Main risk is the uncanny
   valley: a nearly-correct real mouth reads worse than an obviously-fake cartoon
   one.
2. **Multi-character conversation.** Two subjects in one image, each with its own
   session, voice and personality, arguing with each other and with the user.
   Genuine multi-agent orchestration: turn arbitration, separate mouths, shared
   context. High effort, high payoff, touches the audio path.
3. **Word-level karaoke captions**, using audio timestamp events.
4. **Viseme lip-sync**, if a timing source can be found on the Sarvam path.
5. **MediaPipe face landmarks** for automatic mouth and eye placement. Faces only.
6. **Deployment** with HTTPS, a concurrency cap, a reserved presenter slot and
   per-IP rate limiting, so an audience could use it from their phones.
7. **Prompt trimming** to reduce the ~2 second model composition time.
8. **Sound design** — a creak when it shifts, a thunk on the frame bounce.
9. **Unit tests** for the pure functions: mouth geometry, eye derivation, card
   validation and sanitising, coordinate clamping.

## 13. Repository layout

```
server/
  index.mjs            express + ws, session orchestration, TTS pipeline
  character.mjs        the demo chair, delivery/roast/language rules
  characterCard.mjs    card validation, sanitising, prompt assembly
  vision.mjs           one-shot image analysis
  sarvamTts.mjs        streaming Malayalam TTS
  characterStore.mjs   Redis + in-memory cards and transcripts
src/
  App.tsx              stage flow, session lifecycle, mic gating
  components/          PictureStage, MouthEditor, UploadPanel, MouthShape
  lib/                 pcmPlayer, micCapture, realtime, motion, mouth,
                       mouthShape, placement, imagePrep, sessionSnapshot
public/
  pcm-capture-worklet.js, chair.svg, examples/
spike/                 21 throwaway diagnostic scripts, kept as evidence
docs/                  provider capability checklist, demo script, this brief
```

Scripts: `npm run dev` (server + client), `npm run build` (typecheck + build),
plus `npm run spike:*` for the diagnostic scripts.
