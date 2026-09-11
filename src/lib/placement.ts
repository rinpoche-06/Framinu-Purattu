/**
 * Placement of the cartoon features, in normalised image coordinates.
 *
 * Normalised (0..1) rather than pixels so placement survives window resizes,
 * different display sizes and letterboxing without recalculation.
 */

export interface MouthPlacement {
  /** Mouth centre. */
  x: number;
  y: number;
  /** Fraction of image width and height. */
  width: number;
  height: number;
  rotation: number;
}

export interface EyePlacement {
  /** Midpoint between the two eyes. */
  x: number;
  y: number;
  /** Distance between eye centres, as a fraction of image width. */
  spacing: number;
  /** Eye radius, as a fraction of image width. */
  radius: number;
  /**
   * Degrees, applied about the midpoint so the pair tilts together.
   * Needed for faces photographed at an angle, where level eyes look pasted on.
   */
  rotation: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Eyes are derived from the mouth rather than guessed by the vision model.
 *
 * The model's mouth coordinates are already unreliable enough to need a manual
 * editor, so asking it for a second set would add another way to be wrong.
 * "Above the mouth, spread a bit wider" is correct for faces and harmless for
 * objects, and the user can drag it anyway.
 */
export function deriveEyes(mouth: MouthPlacement): EyePlacement {
  return {
    x: mouth.x,
    y: clamp(mouth.y - 0.16, 0.04, 0.94),
    spacing: clamp(mouth.width * 1.5, 0.1, 0.55),
    radius: clamp(mouth.width * 0.3, 0.025, 0.12),
    // Inherit the mouth's tilt: on an angled face both features lean together.
    rotation: mouth.rotation,
  };
}
