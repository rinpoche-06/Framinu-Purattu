# Provider capability checklist

Provider: **Azure AI Foundry — Voice Live API**
Resource: `zone9747-8774-resource`, region `eastus2`, tier S0
SDK: `@azure/ai-voicelive` 1.1.0
Conversation model: `gpt-realtime-2.1` (deployment name)
Output voice: `ml-IN-MidhunNeural` via `azure-standard`

Status values: **verified** = observed in a real API response.
**unverified** = plausible but not yet tested. Never promoted without a test.

## Core requirements

| Capability | Status | Evidence |
|---|---|---|
| Authentication with resource key | verified | spike 01 connected |
| Persistent realtime session | verified | one WebSocket across 5 turns |
| Streamed response audio | verified | `response.audio.delta` events |
| Malayalam speech output | verified | 5/5 turns produced ml-IN audio |
| Malayalam + English code-switching | verified | English words spoken inside Malayalam sentences |
| Conversation memory across turns | verified | turn 5 handled "that's not what I asked" |
| Character instruction following | verified | stayed a chair, never mentioned being an AI |
| Language switching on request | verified | English question got English reply |
| Session instruction updates | verified | `session.update` accepted, echoed in `session.updated` |
| Output transcripts | verified | `response.audio_transcript.done` |
| Live microphone input | **unverified** | deliberately deferred to browser, Phase 1 |
| Barge-in / interruption | **unverified** | needs mic audio; `response.cancel` exists in SDK |
| Short-lived browser credential | **unverified** | decides backend scope. Open question. |

## Measured latency

First audio byte after request, 10 samples across two runs:

| Run | Range |
|---|---|
| Long replies (~11s audio) | 1073–1271 ms |
| Short replies (~6.5s audio) | 960–2332 ms |

Consistently around 1–1.3s with occasional 2.3s outliers. Not yet measured
end-to-end from a real spoken turn, which will add mic capture and VAD
detection time on top.

## Gotchas found the hard way

**`server_vad` is rejected when input transcription is `azure-speech`.**
The service demands an Azure semantic VAD. Use
`turnDetection: { type: "azure_semantic_vad_multilingual" }`. Getting this wrong
silently produced a session with no voice and zero audio bytes.

**Malayalam is absent from Voice Live's default multilingual STT model.**
That model covers 15 languages and `ml-IN` is not among them. Must set
`inputAudioTranscription.language = "ml-IN,en-IN"` explicitly.

**Never set `locale` on the voice.** SDK typings state TTS emits silence for
text in another language when locale is enforced. That would break the
Malayalam-English mixing that makes the comedy work.

**`gpt-realtime` does not list Malayalam as supported.** We use it as the
reasoning model but override speech output to Azure TTS. Do not rely on its
native voices for Malayalam.

## Prompt-level findings

**Romanised Malayalam reads as English.** Without an explicit rule, "Nee ingane
stuck aayittu ethra kaalam aayi?" got a fully English reply. Fixed by stating
that Manglish is still Malayalam.

**Default replies are far too long.** Unconstrained, the model produced 10–12s
of audio per turn. A 20-word cap brought it to 6–7s, and a 14-word cap to
4–6s (8–13 words actual). 14 is the working value.

**A monolingual Malayalam voice cannot speak English sentences.**
`ml-IN-MidhunNeural` rendered a full English reply unintelligibly.

**Manglish / code-switching is NOT viable on this voice.** Tested in spike 05
across ten configs: light, medium and heavy English mixing, with English words
written both in Latin script (`back pain`) and Malayalam script (`ബാക്ക് പെയിൻ`).
Listening verdict: **none were understandable.**

This corrects an earlier assumption. Spike 01 appeared to code-switch fine, but
those replies contained only one or two English words. Once mixing becomes
frequent, the Standard-tier ml-IN voice stumbles badly on script transitions.

Consequence: **the character must speak pure Malayalam.** The prompt has to
actively forbid English words rather than merely allow them sparingly. Comedy
must come from Malayalam vocabulary and from theatrical punctuation, not from
English punchline words.

Also avoid at all costs: the model romanising Malayalam itself (writing
"muthalle muthalle" instead of "മടുത്തു"). Latin letters get English phonology,
so romanised Malayalam is unintelligible. Seen in spike 05 config m2.

Design consequence: **language mode selects the voice.**

| Mode | Voice |
|---|---|
| Malayalam | `ml-IN-MidhunNeural` or `ml-IN-SobhanaNeural` (Standard tier only) |
| Malayalam + English mixing | same ml-IN voice, works fine |
| English | `en-IN-Arjun:DragonHDLatestNeural` (Neural HD, much more natural) |

Switching language mode therefore requires a voice change. Whether voice can be
changed mid-session via `session.update` is **unverified**; spike 03 creates a
fresh session per voice to avoid assuming it.

Malayalam has no DragonHD, no MAI-Voice-2, and no speaking styles, so `rate` and
`pitch` are the only expressiveness levers for the primary language.

## Locked configuration (spike 04, config x4)

Chosen by listening test after 27 samples across four spikes.

| Setting | Value |
|---|---|
| Voice | `ml-IN-MidhunNeural`, `type: azure-standard` |
| Rate / pitch | default, unset. Anything >= 1.1 sounded fast-forwarded |
| Temperature | unset |
| Language | pure Malayalam. English words forbidden in the prompt |
| Writing style | theatrical: opening interjection, `...` pause, `!` ending, one repeated word for emphasis |
| Reply length | 14–16 word cap, one sentence |

User verdict on x4: "slightly good among all other trash sounds." That is an
honest ceiling, not an endorsement.

### Rejected, with reasons

| Option | Why rejected |
|---|---|
| Manglish / code-switching | unintelligible on ml-IN voice (spike 05, 10 configs) |
| HD voices on Malayalam script | "feels like a different language" (spike 04, x7/x8/x10) |
| Faster rate for energy | sounded fast-forwarded at 1.12 (spike 03, ml-6) |
| English-only character | expressive, but loses the joke the project is named after |
| Per-reply voice switching | character would sound like two different people |

### Conclusion

We have reached the ceiling of Azure Malayalam TTS. Malayalam has two
Standard-tier voices, no HD, no MAI-Voice-2, no speaking styles. No further
Azure-side tuning will meaningfully improve expressiveness.

### Alternative provider: also ruled out

Gemini Live API was the obvious fallback, and it is free. Google's
[language support list](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/configure-language-voice)
for Live API covers 24 locales including Hindi, Marathi, Tamil, Telugu and
Bengali — **Malayalam is not among them.**

So this is not an Azure limitation. It is the current state of realtime
Malayalam voice across providers:

| Provider / model | Malayalam realtime voice |
|---|---|
| Azure Voice Live + `ml-IN` Azure TTS | works, Standard tier, flat |
| `gpt-realtime` native audio | not listed as supported |
| Gemini Live API native audio | not supported |
| HD / multilingual voices on ml-IN text | unintelligible (tested) |

Azure `ml-IN-MidhunNeural` is the best available option, not merely the most
convenient one. No further provider search is warranted.

### Recommendation

Ship the x4 configuration and stop tuning voice. Compensate for flat delivery
with levers that do not depend on TTS:

1. **On-screen Malayalam captions.** The provider already emits
   `response.audio_transcript.done`. Reading along removes the comprehension
   problem entirely, and captions were already a Phase 3 item.
2. **Comedy in the writing**, which the theatrical prompt already improves.
3. **Visual comedy**: mouth animation, frame shake, the escape interaction.

The illusion is carried by the picture talking, not by vocal prosody.

## Available but unused

Both confirmed present in the SDK, not yet tested:

- **Viseme and blendshape output.** `animation.outputs` accepts `viseme_id` or
  `blendshapes`, with `onResponseAnimationVisemeDelta` events. Could upgrade the
  mouth from amplitude-reactive to real lip-sync. Unverified for `ml-IN`.
- **Audio timestamps.** `onResponseAudioTimestampDelta`.
- **Direct image input.** `input_image` content part, so the realtime session
  could see the photo itself.
- **Push-to-talk primitives.** `startAudioTurn` / `endAudioTurn`.
- **Server-side echo cancellation and deep noise suppression.**

## Honest architecture note

Voice Live with a non-multimodal model is internally a cascade
(STT -> model -> TTS). We use `gpt-realtime-2.1`, a native audio model, but
override output through Azure TTS to get a Malayalam voice. So output is
synthesised, not native model speech.

What we do **not** do: orchestrate three separate API calls per turn. It is one
persistent session with server-side turn detection. Describe it that way, not as
native speech-to-speech.

---

# Addendum: Sarvam Bulbul v3 evaluation

The conclusion above — that Azure `ml-IN-MidhunNeural` was the best available
option — was correct for the providers checked at the time. It did not hold once
Sarvam was tested.

## What changed the decision

**Manglish works.** This was written off as impossible after spike 05, where ten
code-mixing configurations were all unintelligible on Azure's Standard-tier
voices. Bulbul v3 handles it natively. Listening verdict: "every word is
understandable."

That is not a marginal quality improvement, it changes what the character can
say. Pure Malayalam was a constraint we accepted, not a choice we made.

## Verified API contract

Established by probing, not documentation (spikes 15-17):

| Setting | Value | Why |
|---|---|---|
| Endpoint | `POST /text-to-speech/stream` | REST waits 1831 ms for the whole clip; streaming gives first audio in ~450 ms |
| `output_audio_codec` | `linear16` | default is MP3, which the browser player cannot consume incrementally |
| `speech_sample_rate` | `24000` | default came back as 22050, which would play at the wrong pitch |
| `model` | `bulbul:v3` | |
| Voices | `gokul` male, `roopa` female | cast by listening to all 37 Malayalam-capable voices |

Valid `output_audio_codec` values, from an API validation error: `mp3`,
`linear16`, `mulaw`, and others truncated in the message.

Because that combination yields raw PCM16 at 24 kHz, **no browser changes were
needed** — the bytes pass straight into the existing playback queue. The compiled
client bundle hash was identical before and after the integration.

## Measured latency

Same test on both paths: one conversational turn, question sent to first audio
byte, three samples each.

| Path | Average | Samples |
|---|---|---|
| Sarvam | 2946 ms | 3388, 2951, 2500 |
| Azure | 3270 ms | 2693, 2993, 4124 |

**Correction to an earlier claim.** The "1000-1300 ms" figure quoted for Azure
came from spike 01, which used a short prompt and a direct text question. It was
not comparable to the greeting flow the Sarvam numbers came from, and it made
Sarvam look worse than it is. Measured fairly, they are within noise of each
other and Sarvam is marginally ahead.

The dominant cost on both paths is Voice Live composing the reply. Sarvam's own
synthesis contributes about 500 ms, measured server-side, because text is
synthesised sentence by sentence rather than after the full reply.

## Latency engineering that was required

Naively waiting for the complete reply text before synthesising gave 3911 ms.
Two fixes brought it to ~2950 ms:

1. **Synthesise per sentence** as text deltas arrive, so later sentences render
   while earlier ones play.
2. **Split aggressively.** A 24-character minimum fragment length meant replies
   with no early full stop still waited for the whole text. Lowering it to 7 lets
   the opening interjection flush immediately, and a clause-level fallback at 42
   characters handles comma-heavy Malayalam with no full stop until the end.

Splitting at the *last* terminator rather than the first matters, because the
character uses ellipses constantly and splitting inside one sounds broken.

## Capabilities lost on the Sarvam path

| Capability | Status | Reason |
|---|---|---|
| Server-side echo cancellation | **lost** | service rejects it when modalities are text-only: it needs a reference of the played audio |
| Interruption truncation | **lost** | no audio item exists to truncate; barge-in aborts the Sarvam stream instead |
| Single-provider operation | **lost** | two providers must be up |

The echo cancellation loss is the one with real-world consequences: it makes
presenting through speakers without headphones more likely to cause the character
to interrupt itself.

## Emotion control: not as advertised

Sarvam's marketing mentions emotion control. The actual v3 API exposes only
`pace` (0.5-2.0) and `temperature`. `pitch` and `loudness` were **removed** from
v2 and are not available.

So character emotion comes from three places: which of the 38 voices is cast,
the pace, and the wording itself, since v3 infers prosody from text. Casting is
the biggest lever.

A note on method: I shortlisted candidates by audio duration, on the theory that
slower delivery reads as weary. That was wrong, and inverted — the chosen voices
(`gokul`, `roopa`) were among the *fastest* in the catalogue. Anger carries
energy; the slow voices sounded lifeless. Auditioning all 37 cost ₹5 and was
worth far more than the guess.

## Cost

₹3 per 1000 characters. A reply is roughly 100 characters, so about ₹0.30 each,
or 330 replies on ₹100. The entire evaluation — 60-plus samples across five
spikes — cost about ₹12.
