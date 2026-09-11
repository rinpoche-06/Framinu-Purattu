import { mouthGeometry } from "../lib/mouthShape";

/**
 * Static mouth, used by the placement editor.
 *
 * The talking stage does not use this: it mutates the SVG directly from the
 * animation loop instead of re-rendering sixty times a second.
 */
export function MouthShape({ openness }: { openness: number }) {
  const { outline, interior } = mouthGeometry(openness);

  return (
    <svg className="mouth-svg" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
      <path d={outline} fill="#2a1512" />
      <path d={outline} fill="none" stroke="#0f0908" strokeWidth={3} strokeLinejoin="round" />
      <ellipse
        cx={50}
        cy={interior.cy}
        rx={interior.rx}
        ry={interior.ry}
        fill="#b3453f"
        opacity={interior.opacity}
      />
    </svg>
  );
}
