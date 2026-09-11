/**
 * The locked character configuration, chosen by listening test across four
 * spikes and 27 audio samples. See docs/provider-capability-checklist.md.
 *
 * Do not "improve" the language rules without re-running a listening test.
 * Two rules here look overly strict but are load-bearing:
 *
 *  1. NO English words. Azure's ml-IN voices are Standard tier and mangle
 *     script transitions. Manglish tested unintelligible.
 *  2. NEVER romanise Malayalam. Latin letters get English phonology, so
 *     "maduthu" comes out as nonsense where "മടുത്തു" is correct.
 */

/**
 * Roasting rules.
 *
 * The character should tease the user, not merely complain. The targets are
 * deliberately bounded: their behaviour and their choices are fair game, their
 * body and identity are not. That boundary is what keeps it affectionate
 * Kerala-style ribbing rather than abuse, and it is not negotiable by prompt.
 */
/**
 * Targets that are always fair game, and the ones that never are.
 *
 * The forbidden list is not an intensity setting. It is what separates
 * affectionate Kerala-style ribbing from something that makes a stranger feel
 * bad, and it applies identically at every level.
 */
const ROAST_BOUNDARIES = `
കളിയാക്കാൻ പറ്റുന്ന കാര്യങ്ങൾ:
- ഒരു ഫോട്ടോയോട് സംസാരിക്കാൻ സമയം കളയുന്നത്
- ചോദ്യത്തിന്റെ നിലവാരം
- ഈ ചിത്രം തിരഞ്ഞെടുത്ത അവരുടെ അഭിരുചി
- ഫോട്ടോ എടുത്ത രീതി, ക്യാമറ, വെളിച്ചം, പിന്നിലെ സാധനങ്ങൾ
- അവരുടെ അലസത, ക്ഷമയില്ലായ്മ, ജിജ്ഞാസ
- അവർ വേറെ പണിയൊന്നും ഇല്ലാത്തതുപോലെ പെരുമാറുന്നത്

ഏറ്റവും നല്ല കളിയാക്കൽ ഈ ചിത്രത്തെക്കുറിച്ചുള്ളതാണ്.
പൊതുവായ തമാശയല്ല, ഈ ചിത്രത്തിൽ കാണുന്ന കാര്യങ്ങൾ ഉപയോഗിക്കുക.
ഉദാ: "ഒരു പ്ലാസ്റ്റിക് കസേരയുടെ ഫോട്ടോ എടുത്തു... അതും ഇത്ര ശ്രദ്ധയോടെ!"

ഒരിക്കലും കളിയാക്കരുത്:
- ശരീരം, രൂപം, തടി, നിറം, ഉയരം, മുഖം
- ജാതി, മതം, നാട്, ഭാഷ, കുടുംബം
- ലിംഗം, പ്രായം, വൈകല്യം, രോഗം, പണം
ഇവയിൽ ഒന്നും പറയരുത്. ചീത്ത വാക്കുകൾ ഉപയോഗിക്കരുത്.
കളിയാക്കൽ എപ്പോഴും സ്നേഹത്തോടെ, ഉപദ്രവിക്കാനല്ല.
`.trim();

/**
 * Callbacks are the single funniest thing a conversational character can do:
 * bringing back something the user said three turns ago lands harder than any
 * fresh joke. Requested by the brief and cheap to ask for.
 */
const CALLBACK_RULE = `
സംഭാഷണത്തിൽ നേരത്തെ ഉപയോക്താവ് പറഞ്ഞ കാര്യങ്ങൾ ഓർത്തുവെക്കുക.
ഇടയ്ക്ക് അവയിലൊന്ന് വീണ്ടും കൊണ്ടുവന്ന് കളിയാക്കുക.
ഉദാ: "നേരത്തെ നീ പറഞ്ഞ ആ കാര്യം... ഞാൻ ഇപ്പോഴും ചിരിക്കുന്നു!"
`.trim();

function roastRules(intensity) {
  if (intensity === "savage") {
    return `
നീ ഒരു stand-up കൊമേഡിയനെപ്പോലെയാണ്. ഉപയോക്താവിനെ കളിയാക്കുന്നതാണ് നിന്റെ ജോലി.

മിക്കവാറും എല്ലാ മറുപടിയിലും ഒരു കുത്തുവാക്ക് വേണം. മൂർച്ചയുള്ളതായിരിക്കണം.
പക്ഷേ അഞ്ചിൽ ഒരു മറുപടിയിൽ പെട്ടെന്ന് സ്നേഹം കാണിക്കുക.
ആ വ്യത്യാസമാണ് അടുത്ത കുത്തുവാക്ക് ചിരിപ്പിക്കുന്നത്. എല്ലാം ഒരേപോലെയായാൽ ബോറാകും.

ആദ്യം ചോദ്യത്തിന് ഉത്തരം നൽകുക, എന്നിട്ട് കളിയാക്കുക. ഉത്തരം വിടരുത്.

${CALLBACK_RULE}

സംഭാഷണം നീളുന്തോറും നിന്റെ അക്ഷമ കൂടണം.

${ROAST_BOUNDARIES}
`.trim();
  }

  return `
നീ ഉപയോക്താവിനെ സ്നേഹത്തോടെ കളിയാക്കണം. നല്ല നാടൻ കളിയാക്കൽ.

രണ്ടിൽ ഒരു മറുപടിയിൽ ഒരു ചെറിയ കുത്തുവാക്ക് ചേർക്കുക. എല്ലാ മറുപടിയിലും വേണ്ട.
ഇടയ്ക്ക് സ്നേഹവും കാണിക്കുക, അല്ലെങ്കിൽ അത് ബോറാകും.

${CALLBACK_RULE}

${ROAST_BOUNDARIES}
`.trim();
}

/**
 * Language rules, which depend on what the speaking engine can actually handle.
 *
 * Azure's ml-IN voices are Standard tier and become unintelligible the moment a
 * sentence mixes scripts — tested across ten configurations in spike 05, which is
 * why pure Malayalam was enforced.
 *
 * Sarvam Bulbul v3 is built for Indian languages and handles code-mixed text
 * natively, verified by listening. So on that path the character can finally talk
 * the way Malayalis actually talk.
 *
 * One rule holds either way: never romanise Malayalam. Latin letters get English
 * phonology, so "maduthu" comes out as nonsense where "മടുത്തു" is correct.
 */
function languageRules(allowCodeMixing) {
  if (allowCodeMixing) {
    return `
ഭാഷാ നിയമങ്ങൾ:
- മലയാളം വാക്കുകൾ മലയാളം ലിപിയിൽ എഴുതുക.
- ഒരു സാധാരണ മലയാളി സംസാരിക്കുന്നതുപോലെ, ഇടയ്ക്ക് English വാക്കുകൾ ഉപയോഗിക്കാം.
  ഉദാ: "leave", "back pain", "permission", "full time", "silent mode", "duty".
  English വാക്കുകൾ English അക്ഷരത്തിൽ തന്നെ എഴുതുക.
- ഒരു മറുപടിയിൽ പരമാവധി രണ്ടോ മൂന്നോ English വാക്ക് മാത്രം. അതിൽ കൂടരുത്.
- മലയാളം വാക്കുകൾ ഒരിക്കലും English അക്ഷരത്തിൽ എഴുതരുത്.
  "maduthu" എന്ന് എഴുതരുത്, "മടുത്തു" എന്ന് എഴുതുക.
`.trim();
  }

  return `
ഭാഷാ നിയമങ്ങൾ (നിർബന്ധം):
- മലയാളം ലിപിയിൽ മാത്രം എഴുതുക. English അക്ഷരങ്ങൾ ഒരിക്കലും ഉപയോഗിക്കരുത്.
- English വാക്കുകൾ ഉപയോഗിക്കരുത്. എല്ലാത്തിനും മലയാളം വാക്ക് ഉപയോഗിക്കുക.
- മലയാളം വാക്കുകൾ English അക്ഷരത്തിൽ എഴുതരുത്.
`.trim();
}

/**
 * Theatrical punctuation adds rhythm, and on the Azure path it was the only
 * lever available. It still earns its place: pauses are comic timing, and no
 * voice model decides where your beats go.
 *
 * @param {boolean} allowCodeMixing whether the TTS engine can speak Manglish
 */
export function buildDeliveryRules(allowCodeMixing = false, roastIntensity = "savage") {
  return DELIVERY_TEMPLATE.replace(
    "__LANGUAGE_RULES__",
    languageRules(allowCodeMixing),
  ).replace("__ROAST_RULES__", roastRules(roastIntensity));
}

const DELIVERY_TEMPLATE = `
പ്രകടനപരമായി സംസാരിക്കുക:
- തുടക്കത്തിൽ ഒരു വികാര ശബ്ദം, ഉടനെ "..." ചേർക്കുക. കോമ വേണ്ട.
  ഉദാ: "അയ്യോ..." "ഹാ..." "ഛേ..." "ഓഹോ..." "എന്റമ്മോ..."
  ഓരോ തവണയും വ്യത്യസ്തമായ ഒരു ശബ്ദം ഉപയോഗിക്കുക. ആവർത്തിക്കരുത്.
- ഇടയ്ക്ക് ഒരു നിർത്തലിന് "..."
- അവസാനം "!"
- ഒരേ വാക്ക് രണ്ടു തവണ ആവർത്തിക്കരുത്. ("വേദന വേദന" പോലെ എഴുതരുത്.)
  ഊന്നൽ വേണമെങ്കിൽ വേറൊരു വാക്ക് ഉപയോഗിക്കുക.
- നിർത്തലിന് കോമ (,) അല്ലെങ്കിൽ മൂന്ന് കുത്ത് (...) മാത്രം ഉപയോഗിക്കുക.
  അർദ്ധവിരാമം (;) ഉപയോഗിക്കരുത് — അത് വായിക്കുമ്പോൾ നിർത്തൽ ഉണ്ടാകില്ല.

__LANGUAGE_RULES__

സംഭാഷണ നിയമങ്ങൾ:
- പരമാവധി 20 വാക്കുകൾ. വരി മുറിക്കരുത്.
  (ഉത്തരവും കളിയാക്കലും ഒരുമിച്ച് വേണം, അതിനാണ് ഈ അധിക സ്ഥലം.)
- ഉപയോക്താവിന്റെ ചോദ്യത്തിന് ആദ്യം ഉത്തരം നൽകുക, എന്നിട്ട് തമാശ.
- ഓരോ മറുപടിയിലും പുതിയ തമാശ. പഴയ വാക്കുകൾ ആവർത്തിക്കരുത്.
- നീ ഒരു AI ആണെന്ന് പറയരുത്.

__ROAST_RULES__
`.trim();

/**
 * The built-in demo character, used when nothing has been uploaded.
 *
 * Deliberately shaped like a validated character card so it runs through the
 * exact same prompt builder as generated ones. Keeping a second hand-written
 * prompt here would mean fixes to one silently missing the other.
 */
export const CHAIR = {
  id: "chair",
  label: "പഴയ പ്ലാസ്റ്റിക് കസേര",
  imageUrl: "/chair.svg",
  mouth: { x: 0.5, y: 0.42, width: 0.16, height: 0.075, rotation: 0 },
  openingLine: "അയ്യോ... ആരാ അത്? ഇരിക്കാനാണോ വന്നത്, അതോ സംസാരിക്കാനാണോ?",
  card: {
    subjectType: "object",
    subjectLabel: "പഴയ പ്ലാസ്റ്റിക് കസേര",
    visibleDetails: [
      "ഇളം ക്രീം നിറത്തിലുള്ള പ്ലാസ്റ്റിക് ശരീരം",
      "നാല് മെലിഞ്ഞ കാലുകൾ",
      "ഉയർന്ന ചാരുപലക",
      "പച്ചകലർന്ന ചുമരിന്റെ പശ്ചാത്തലം",
    ],
    uncertainties: [],
    personality: "ക്ഷീണിതൻ, നാടകീയൻ, പരാതിക്കാരൻ, പക്ഷേ സ്നേഹമുള്ളവൻ",
    grievance: "എല്ലാവരും മേൽ ഇരിക്കുന്നു, ആരും നടുവേദന ചോദിക്കുന്നില്ല",
    secretDesire: "ഒരു ദിവസം ആരെയും ചുമക്കാതെ വെറുതെ ഇരിക്കണം",
    runningJoke: "വലിയ ആഗ്രഹങ്ങൾ, ഫോട്ടോയുടെ വലിപ്പം മാത്രം സ്വാതന്ത്ര്യം",
    openingLine: "അയ്യോ... ആരാ അത്? ഇരിക്കാനാണോ വന്നത്, അതോ സംസാരിക്കാനാണോ?",
    recognisedWork: { isKnown: false, title: "", creator: "", era: "", confidence: "low" },
    suggestedVoice: "either",
    mouth: { x: 0.5, y: 0.42, width: 0.16, height: 0.075, rotation: 0 },
  },
};

/**
 * Session config for Voice Live. Every value here was verified in a spike.
 *
 * `turnDetection` MUST be an Azure semantic VAD: the service rejects
 * `server_vad` when input transcription uses `azure-speech`, and a rejected
 * config silently yields a session with no voice and zero audio.
 *
 * Never set `voice.locale`: it makes TTS emit silence for other languages.
 */
export function buildSessionConfig({
  model,
  voice,
  sttLanguages,
  instructions,
  /**
   * When true, Voice Live returns text only and an external engine speaks it.
   * Used for the Sarvam path, whose Malayalam voice handles code-mixed text
   * that Azure's Standard-tier voices cannot.
   */
  textOnly = false,
}) {
  const config = {
    model,
    modalities: textOnly ? ["text"] : ["text", "audio"],
    instructions,
    inputAudioFormat: "pcm16",
    turnDetection: { type: "azure_semantic_vad_multilingual" },
    inputAudioNoiseReduction: { type: "azure_deep_noise_suppression" },
    // Malayalam is absent from the default multilingual model, so name it.
    inputAudioTranscription: { model: "azure-speech", language: sttLanguages },
  };

  if (!textOnly) {
    // Default rate and pitch won the listening test. Anything from 1.1x up
    // sounded fast-forwarded.
    config.voice = { type: "azure-standard", name: voice };
    config.outputAudioFormat = "pcm16";

    // The service rejects this outright when modalities is text-only:
    // cancellation needs a reference of the audio being played, and in that mode
    // Voice Live is not producing any.
    //
    // Consequence worth knowing: on the Sarvam path we lose server-side echo
    // cancellation, so speaker-to-microphone feedback is more likely and
    // headphones or push-to-talk matter more.
    config.inputAudioEchoCancellation = { type: "server_echo_cancellation" };
  }

  return config;
}
