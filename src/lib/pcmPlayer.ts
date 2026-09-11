/**
 * Playback queue for streamed PCM16 audio, with an inline analyser.
 *
 * Two things this gets deliberately right:
 *
 *  1. The analyser is ON the path to the speakers, so the mouth is driven by
 *     audio the user is actually hearing, not by "a packet arrived" or by the
 *     microphone. Those shortcuts look convincing until the audio desyncs.
 *
 *  2. Chunks are scheduled against a running cursor rather than played on
 *     arrival, which is what avoids clicks and gaps between deltas.
 */

export const PLAYBACK_SAMPLE_RATE = 24000;

export class PcmPlayer {
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  // Explicit ArrayBuffer type parameter: getFloatTimeDomainData rejects the
  // ArrayBufferLike default because it could be a SharedArrayBuffer.
  private readonly timeDomain: Float32Array<ArrayBuffer>;
  private readonly active = new Set<AudioBufferSourceNode>();

  /** Absolute context time at which the next chunk should begin. */
  private nextStartTime = 0;

  /** Audio duration enqueued for the current response, in seconds. */
  private queuedSeconds = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.timeDomain = new Float32Array(this.analyser.fftSize);

    // Built once. Reconnecting this chain on every chunk is how you end up
    // with doubled audio.
    this.gain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  /** Append one chunk of raw PCM16 mono audio. */
  enqueue(pcm16: ArrayBuffer): void {
    const samples = new Int16Array(pcm16);
    if (samples.length === 0) return;

    const buffer = this.ctx.createBuffer(1, samples.length, PLAYBACK_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      channel[i] = samples[i] / 0x8000;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    // A small lead time absorbs jitter without being audible. Without it, a
    // late chunk gets scheduled in the past and is dropped.
    const startAt = Math.max(this.nextStartTime, this.ctx.currentTime + 0.02);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.queuedSeconds += buffer.duration;

    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      source.disconnect();
    };
  }

  /**
   * Stop immediately and drop anything queued. Used for barge-in, mute, reset
   * and disconnect. The mouth closes as a consequence, because level goes to 0.
   */
  clear(): void {
    for (const source of this.active) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // Already finished. Nothing to do.
      }
    }
    this.active.clear();
    this.nextStartTime = 0;
    this.queuedSeconds = 0;
  }

  /** Called when a new response begins, so played duration is per response. */
  beginResponse(): void {
    this.queuedSeconds = 0;
    if (!this.isPlaying) this.nextStartTime = 0;
  }

  /**
   * How much of the current response the user has actually heard.
   *
   * Needed for truncation on barge-in. Audio arrives faster than realtime, so
   * "how much we received" heavily overstates "how much was heard" — and
   * reporting the wrong figure leaves the model believing it said things nobody
   * heard. Must be read before clear(), which resets the counters.
   */
  get playedSeconds(): number {
    const remaining = Math.max(0, this.nextStartTime - this.ctx.currentTime);
    return Math.max(0, this.queuedSeconds - remaining);
  }

  setMuted(muted: boolean): void {
    this.gain.gain.value = muted ? 0 : 1;
  }

  /** True while audio is scheduled or sounding. */
  get isPlaying(): boolean {
    return this.ctx.currentTime < this.nextStartTime - 0.01;
  }

  /** Root mean square of what is currently going to the speakers, 0..1-ish. */
  readLevel(): number {
    if (!this.isPlaying) return 0;

    this.analyser.getFloatTimeDomainData(this.timeDomain);
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomain.length; i++) {
      sumSquares += this.timeDomain[i] * this.timeDomain[i];
    }
    return Math.sqrt(sumSquares / this.timeDomain.length);
  }
}
