# Demo script — ഫ്രെയിമിന് പുറത്ത്

A two to three minute run. Read the checklist first; most demo failures are
setup, not software.

---

## T-20 minutes: checklist

| Check | Why it matters |
|---|---|
| Sarvam credit balance | If it runs out the picture goes mute mid-demo. A reply costs about ₹0.30, so a demo is ~₹7. |
| `npm run dev` running, no errors | Server prints `tts sarvam` and `voices gokul / roopa`. |
| Open `/api/health` | Confirms which engine is live in one glance. |
| **Earphones OUT, speakers ON** | This is the configuration you are presenting in. Test it, do not assume. |
| Speaker volume set | Loud enough for the room, no louder. |
| Push-to-talk is ON | It is the default. Confirm the checkbox. |
| One full rehearsal exchange | Hold space, ask something, hear a reply. Do this after every restart. |
| Browser zoom at 100% | Mouth placement is proportional, but a stray zoom makes the frame awkward. |
| Close other tabs using the mic | Another tab holding the microphone will break capture. |

If anything above fails, fix it before walking on. There is no recovering a dead
microphone in front of judges.

---

## The run

### 1. The pitch (20 seconds)

> "This is Framinu Purathu — Out of Frame. You give it a picture, and whatever
> is in that picture starts talking to you. In Malayalam. And it is not happy
> about being stuck in there."

Landing screen is already up, three examples visible.

### 2. Mona Lisa (60 seconds) — the strongest opening

Tap the **മോണാലിസ** example. While it analyses, say:

> "It is looking at the picture now, working out what the subject is and
> inventing a personality from what it can actually see."

The prepare screen appears. Point at the card, then:

- Set voice to **സ്ത്രീ ശബ്ദം** (female)
- Leave roast on **Savage**
- Press **ജീവൻ കൊടുക്കൂ**

Then hold space and ask, in this order:

**"നിന്നെ ആരാണ് വരച്ചത്?"** *(Who painted you?)*

This is the reliable crowd-pleaser: it names Leonardo da Vinci, because famous
artworks are identified deliberately while private individuals never are.

**"എന്നെക്കുറിച്ച് നിന്റെ അഭിപ്രായം എന്താ?"** *(What do you think of me?)*

This is where it roasts you. Let it land, do not talk over it.

Then press **പുറത്ത് ചാടാൻ നോക്കൂ · Escape**. The picture lunges, hits the frame
edge and complains about it.

### 3. A second subject (45 seconds) — proves it reads the actual image

**വേറെ ചിത്രം**, then upload or photograph a drawing of your own.

The one-tap examples are now just the Mona Lisa. The appam and chair buttons are
gone: a cartoon mouth stuck on an object was the weakest version of the idea, and
leading with it undersold the rest.

A hand-drawn face is the strongest second subject, because the personality is
built from what is really in the picture and the audience watched you supply it.

Switch voice to male. Ask:

**"നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ?"** *(Aren't you tired of sitting there?)*

If it is a drawing somebody made in the room:

**"ആരാ നിന്നെ വരച്ചത്?"** *(Who drew you?)*

### 4. The close (20 seconds)

Stop holding space and stay quiet for 20 seconds. It will prod you unprompted.
That lands well as an ending because it shows the character has its own will.

> "Everything you heard was generated live. No recordings, no pre-rendered
> video. The mouth is animated from the audio that is actually playing."

---

## Questions that reliably work

Keep to these under pressure. They are tested.

| Malayalam | English |
|---|---|
| നിന്നെ ആരാണ് വരച്ചത്? | Who made you? |
| നിനക്ക് ഇവിടെ ഇരുന്ന് മടുത്തില്ലേ? | Aren't you tired of being there? |
| എന്നെക്കുറിച്ച് നിന്റെ അഭിപ്രായം എന്താ? | What do you think of me? |
| ഫ്രെയിമിന് പുറത്ത് പോയാൽ എന്ത് ചെയ്യും? | What would you do outside the frame? |
| ഞാൻ നല്ല ഫോട്ടോഗ്രാഫർ ആണോ? | Am I a good photographer? |

Suggested-question chips are on screen if you blank, and they are clickable, so
you can trigger one without speaking.

---

## If something goes wrong

**It talks over itself, or answers noise.** Push-to-talk is off. Turn it on.

**Nothing is heard but captions appear.** Sarvam is failing, most likely credit.
Set `TTS_PROVIDER=azure` in `.env`, restart the server, carry on. You lose the
English word mixing but keep a working voice. Takes about ten seconds.

**"വീണ്ടും ബന്ധിപ്പിക്കുന്നു..."** It is reconnecting on its own. Wait. It keeps
your picture. Do not touch anything.

**It reverted to the chair.** The card restore failed. Press Stop, then wake it
again, and re-upload.

**Microphone permission was refused.** Type instead — there is a text box, and it
still answers out loud.

**Total silence and nothing works.** Fall back to talking through the code and
the docs. The provider capability checklist is a genuinely interesting story on
its own: nine spikes, sixty audio samples, and two providers that cannot speak
Malayalam at all.

---

## Claims that are true, and worth making

These hold up to scrutiny. Do not embellish past them.

- **Live speech, not a recording.** One persistent realtime session per
  conversation.
- **No video generation.** The mouth is a cartoon overlay animated from the
  amplitude of the audio actually reaching the speakers.
- **Audio-reactive, not lip-sync.** It moves in time with speech but does not
  form accurate Malayalam mouth shapes. Say this plainly if asked; real viseme
  data is available from the provider and is a deliberate next step.
- **Malayalam was genuinely hard.** `gpt-realtime` does not list Malayalam.
  Gemini Live does not support it at all. Azure has exactly two Malayalam
  voices, both entry tier, and they cannot speak mixed Malayalam-English.
- **Manglish works because of a deliberate provider switch.** Sarvam Bulbul v3
  handles code-mixed Indic text, which is why the character can say
  "പുറത്തുപോകാൻ permission ഇല്ല" and be understood.
- **The API key never reaches the browser.** The realtime session runs on the
  server; the build is checked for key leakage.
- **Famous artworks are identified, private people are not.** A deliberate
  distinction, not an accident.

## Claims to avoid

- Do not call it lip-sync.
- Do not claim it is the real person in a photograph speaking.
- Do not promise a latency figure. It is roughly three seconds to first audio,
  mostly model composition time, and it varies.