/**
 * Microphone capture. Hands PCM16 frames to a callback.
 *
 * Echo matters here: the character's own voice leaking back into the mic makes
 * it interrupt itself and reply to itself. We ask the browser for cancellation
 * and the service also applies its own, but headphones remain the real fix and
 * the UI says so.
 */

export type PcmFrameHandler = (frame: ArrayBuffer) => void;

export class MicCapture {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly onFrame: PcmFrameHandler,
  ) {}

  async start(): Promise<void> {
    if (this.stream) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    await this.ctx.audioWorklet.addModule("/pcm-capture-worklet.js");

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.worklet.port.onmessage = (event) => {
      this.onFrame(event.data as ArrayBuffer);
    };

    // A worklet with no downstream connection may not be pulled by the graph,
    // so route it through a silent gain node instead of the destination
    // directly. Connecting it audibly would echo the microphone.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;

    this.source.connect(this.worklet);
    this.worklet.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  /**
   * Gate capture without dropping the stream or re-prompting for permission.
   *
   * The worklet keeps emitting frames while muted, just filled with silence, so
   * the server's turn detection still sees a continuous stream. Disabling the
   * track as well means nothing is captured even if the worklet lags a frame
   * behind the message.
   */
  setMuted(muted: boolean): void {
    this.worklet?.port.postMessage({ type: "mute", value: muted });
    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  stop(): void {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.sink?.disconnect();
    this.sink = null;

    // Releases the browser's recording indicator. Easy to forget, and users
    // notice when a tab keeps the mic light on.
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
  }
}
