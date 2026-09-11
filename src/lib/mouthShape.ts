/**
 * Mouth geometry, shared by the animated stage and the static editor preview.
 *
 * Kept as a pure function of openness so the animation loop can write the path
 * straight to the SVG element without going through React.
 */

/** Never fully shut, so a closed mouth still reads as lips rather than nothing. */
export const MIN_OPENNESS = 0.06;

export interface MouthGeometry {
  /** SVG path for a 100x60 viewBox. */
  outline: string;
  /** Interior (tongue) ellipse, hidden when barely open. */
  interior: { cy: number; rx: number; ry: number; opacity: number };
}

export function mouthGeometry(openness: number): MouthGeometry {
  const open = Math.min(1, Math.max(0, openness));

  // The jaw drops further than the upper lip lifts, which is how mouths work.
  const topY = 30 - open * 13;
  const bottomY = 30 + open * 24;

  const visible = Math.max(0, (open - MIN_OPENNESS) / (1 - MIN_OPENNESS));

  return {
    outline: `M4 30 Q50 ${topY.toFixed(2)} 96 30 Q50 ${bottomY.toFixed(2)} 4 30 Z`,
    interior: {
      cy: 30 + open * 13,
      rx: 26 * visible,
      ry: 7 * visible,
      opacity: visible > 0.15 ? 0.85 : 0,
    },
  };
}
