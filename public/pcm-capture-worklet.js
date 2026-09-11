/**
 * Microphone capture worklet.
 *
 * Converts the browser's Float32 audio into PCM16 and posts it to the main
 * thread in ~50 ms chunks. The AudioContext is created at 24 kHz so the browser
 * handles resampling for us and this stays a straight format conversion.
 *
 * Runs on the audio thread, so no allocations in the steady state beyond the
 * one buffer we hand off.
 */

const TARGET_SAMPLES = 1200; // 50 ms at 24 kHz

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(TARGET_SAMPLES);
    this._offset = 0;
    this._muted = false;

    this.port.onmessage = (event) => {
      if (event.data?.type === "mute") {
        this._muted = Boolean(event.data.value);
      }
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // When muted we emit SILENCE rather than dropping frames. The server's
      // voice activity detection needs a continuous stream to recognise that a
      // turn has ended; sending nothing at all just leaves it waiting.
      this._buffer[this._offset++] = this._muted ? 0 : channel[i];

      if (this._offset === TARGET_SAMPLES) {
        const pcm = new Int16Array(TARGET_SAMPLES);
        for (let j = 0; j < TARGET_SAMPLES; j++) {
          const clamped = Math.max(-1, Math.min(1, this._buffer[j]));
          pcm[j] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this._offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
