/**
 * Maps audio energy to mouth openness.
 *
 * This is audio-reactive animation, not phoneme-accurate lip-sync. The mouth
 * opens in time with speech loudness. It does not form Malayalam visemes, and
 * the documentation says so plainly rather than overselling it.
 *
 * (Voice Live can emit real viseme events, which would be genuine lip-sync.
 * That is a later upgrade, deliberately not on the critical path.)
 */

import { MIN_OPENNESS } from "./mouthShape";

/** Below this RMS we treat the signal as silence and shut the mouth. */
const NOISE_FLOOR = 0.006;

/** RMS that counts as fully open. Speech peaks well below 1.0. */
const FULL_OPEN_RMS = 0.16;

/** Opening is fast, closing is slower. Matches how speech actually looks. */
const ATTACK = 0.55;
const RELEASE = 0.18;

export class MouthAnimator {
  private openness = 0;

  /**
   * Advance the animation one frame.
   * @param level raw RMS from the playback analyser
   * @param speaking whether audio is actually sounding right now
   */
  update(level: number, speaking: boolean): number {
    let target = 0;

    if (speaking && level > NOISE_FLOOR) {
      // Perceived loudness is closer to a square root curve than linear, which
      // keeps quiet syllables visible instead of barely moving.
      const normalised = Math.sqrt(
        Math.min(1, (level - NOISE_FLOOR) / (FULL_OPEN_RMS - NOISE_FLOOR)),
      );
      target = MIN_OPENNESS + normalised * (1 - MIN_OPENNESS);
    }

    const coefficient = target > this.openness ? ATTACK : RELEASE;
    this.openness += (target - this.openness) * coefficient;

    if (this.openness < 0.005) this.openness = 0;
    return Math.min(1, Math.max(0, this.openness));
  }

  /** Snap shut. Used on stop, mute, interruption, disconnect and reset. */
  reset(): void {
    this.openness = 0;
  }
}
