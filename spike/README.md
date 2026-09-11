# Phase 0 spike — throwaway code

This folder is **not** the application. It exists to answer questions with real
API responses instead of assumptions. Everything here gets deleted or rewritten
once Phase 1 starts.

## Why these two scripts

The project is Malayalam-first. The single biggest risk is that the provider
speaks Malayalam badly, and no amount of engineering fixes that. So we test the
audio before building any UI.

`gpt-realtime` does **not** list Malayalam among its supported languages, so we
route output through Azure TTS (`ml-IN-MidhunNeural`) via Voice Live instead of
relying on the native-audio voices.

## Run

```
npm install
copy .env.example .env      # then fill in endpoint + key
npm run spike:voice
```

Then **listen to the generated `spike/out/*.wav` files.** The script cannot
judge whether a chair is funny in Malayalam. You can.

For the image test, drop a photo somewhere and run:

```
npm run spike:vision -- path\to\chair.jpg
```

## What each test is really checking

| Test | Question it answers |
|---|---|
| 1 pure Malayalam | Is the Malayalam pronunciation demo-quality? |
| 2 Manglish input | Does romanised Malayalam input work at all? |
| 3 code-switch | Does mixed Malayalam+English output survive, or go silent? |
| 4 English | Does it switch languages on request? |
| 5 correction | Does it keep conversational context across turns? |

Test 3 is the one I expect to be weakest. Azure docs warn that enforcing a
`locale` on the voice makes TTS emit silence for foreign-language text, so we
deliberately leave `locale` unset. If mixed output still breaks, the fallback is
separate pure-Malayalam and pure-English modes.

## Known gaps in this spike, on purpose

- **No microphone.** Node mic capture needs SoX, which is a Windows headache and
  proves nothing the browser won't prove better in Phase 1.
- **No barge-in test.** Needs live mic audio. Deferred to Phase 1.
- **No browser credential test.** Still open: can the browser get a short-lived
  token, or must the backend relay audio? This decides backend scope.
