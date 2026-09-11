/**
 * Continuous animation primitives.
 *
 * None of these touch React state. They are stepped from a single
 * requestAnimationFrame loop and written straight to DOM attributes, because
 * per-frame React state means a re-render every frame for values nothing else
 * depends on.
 */

/** True when the user has asked the OS to reduce motion. Live, not read once. */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  onChange(query.matches);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/**
 * Lightly damped spring.
 *
 * Used instead of mapping input straight to output so movement lags a little
 * and overshoots slightly on the way back. That lag is most of the difference
 * between "physical" and "CSS transition".
 */
export class Spring {
  private position: number;
  private velocity = 0;

  constructor(
    initial = 0,
    private readonly stiffness = 90,
    private readonly damping = 14,
  ) {
    this.position = initial;
  }

  step(target: number, dt: number): number {
    // Clamped so a background tab returning to focus cannot explode the spring.
    const step = Math.min(dt, 1 / 30);
    const acceleration =
      (target - this.position) * this.stiffness - this.velocity * this.damping;
    this.velocity += acceleration * step;
    this.position += this.velocity * step;
    return this.position;
  }

  get value(): number {
    return this.position;
  }

  reset(value = 0): void {
    this.position = value;
    this.velocity = 0;
  }
}

/**
 * One-pole smoothing filter, used to derive a slow speech envelope from the
 * same audio level that drives the mouth.
 *
 * This is the detail that decides whether body motion looks good: the mouth
 * responds per syllable, the body must respond per phrase. Same input signal,
 * deliberately much longer time constant. Matching them produces a vibrating
 * puppet.
 */
export class EnvelopeFollower {
  private value = 0;

  constructor(
    private readonly attack = 0.08,
    private readonly release = 0.03,
  ) {}

  step(input: number): number {
    const coefficient = input > this.value ? this.attack : this.release;
    this.value += (input - this.value) * coefficient;
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

/**
 * Blink scheduler. Random intervals, occasional double blinks.
 *
 * Static faces read as dead, and a blink is the cheapest possible fix. Returns
 * 1 for a fully open eye and near 0 mid-blink.
 */
export class BlinkController {
  private nextBlinkAt = 0;
  private blinkStartedAt = -1;
  private queuedBlinks = 0;

  private static readonly DURATION = 0.14;

  constructor(private readonly minGap = 2.4, private readonly maxGap = 6.5) {}

  private schedule(now: number): void {
    this.nextBlinkAt = now + this.minGap + Math.random() * (this.maxGap - this.minGap);
  }

  /** @returns eyelid openness, 1 open and 0.06 shut */
  step(now: number): number {
    if (this.nextBlinkAt === 0) this.schedule(now);

    if (this.blinkStartedAt < 0 && now >= this.nextBlinkAt) {
      this.blinkStartedAt = now;
      // Roughly one blink in four is a double, which is how real blinking looks.
      this.queuedBlinks = Math.random() < 0.25 ? 1 : 0;
    }

    if (this.blinkStartedAt < 0) return 1;

    const progress = (now - this.blinkStartedAt) / BlinkController.DURATION;

    if (progress >= 1) {
      this.blinkStartedAt = -1;
      if (this.queuedBlinks > 0) {
        this.queuedBlinks -= 1;
        this.blinkStartedAt = now + 0.06;
      } else {
        this.schedule(now);
      }
      return 1;
    }

    // Down and back up. Closing is faster than opening.
    const shape = progress < 0.45 ? progress / 0.45 : 1 - (progress - 0.45) / 0.55;
    return 1 - 0.94 * Math.min(1, Math.max(0, shape));
  }

  /** Force eyes open, e.g. when a session ends. */
  reset(): void {
    this.blinkStartedAt = -1;
    this.nextBlinkAt = 0;
    this.queuedBlinks = 0;
  }
}

/**
 * Where the eyes are looking, in -1..1 on each axis.
 *
 * Follows the pointer when it is moving, and drifts around on its own when it
 * is not, so the character does not freeze into a stare the moment you stop
 * moving the mouse.
 */
export class GazeController {
  private readonly x = new Spring(0, 70, 12);
  private readonly y = new Spring(0, 70, 12);
  private targetX = 0;
  private targetY = 0;
  private lastPointerAt = -Infinity;
  private nextSaccadeAt = 0;

  private static readonly POINTER_HOLD = 2.5;

  /** @param nx -1..1 horizontally from the picture centre */
  setPointer(nx: number, ny: number, now: number): void {
    this.targetX = Math.max(-1, Math.min(1, nx));
    this.targetY = Math.max(-1, Math.min(1, ny));
    this.lastPointerAt = now;
  }

  step(now: number, dt: number): { x: number; y: number } {
    const pointerIsStale = now - this.lastPointerAt > GazeController.POINTER_HOLD;

    if (pointerIsStale) {
      if (now >= this.nextSaccadeAt) {
        // Small idle wandering, not full-range, so it reads as thinking rather
        // than as searching the room.
        this.targetX = (Math.random() - 0.5) * 0.9;
        this.targetY = (Math.random() - 0.5) * 0.6;
        this.nextSaccadeAt = now + 1.4 + Math.random() * 2.6;
      }
    }

    return {
      x: this.x.step(this.targetX, dt),
      y: this.y.step(this.targetY, dt),
    };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.targetX = 0;
    this.targetY = 0;
  }
}
