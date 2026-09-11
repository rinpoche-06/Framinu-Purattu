import { useCallback, useRef, useState } from "react";
import { MouthShape } from "./MouthShape";
import type { EyePlacement, MouthPlacement } from "../lib/placement";

type Mode =
  | "mouth-move"
  | "mouth-resize"
  | "mouth-rotate"
  | "eyes-move"
  | "eyes-resize"
  | "eyes-rotate";

interface Props {
  imageUrl: string;
  aspectRatio: number;
  mouth: MouthPlacement;
  eyes: EyePlacement | null;
  onMouthChange: (mouth: MouthPlacement) => void;
  onEyesChange: (eyes: EyePlacement) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Placement editor for the cartoon features.
 *
 * The vision model's coordinates are a rough suggestion, not face landmarks, so
 * manual adjustment is the real mechanism rather than a fallback. Drag to move,
 * corner handle to resize, top handle to rotate.
 */
export function MouthEditor({
  imageUrl,
  aspectRatio,
  mouth,
  eyes,
  onMouthChange,
  onEyesChange,
}: Props) {
  const pictureRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  /** Pointer-to-centre offset at drag start, so nothing jumps under the cursor. */
  const grabOffset = useRef({ x: 0, y: 0 });

  const viewHeight = Math.round(1000 / aspectRatio);

  const beginDrag = useCallback(
    (nextMode: Mode) => (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = pictureRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (nextMode === "mouth-move") {
        grabOffset.current = {
          x: (event.clientX - rect.left) / rect.width - mouth.x,
          y: (event.clientY - rect.top) / rect.height - mouth.y,
        };
      } else if (nextMode === "eyes-move" && eyes) {
        grabOffset.current = {
          x: (event.clientX - rect.left) / rect.width - eyes.x,
          y: (event.clientY - rect.top) / rect.height - eyes.y,
        };
      }

      (event.target as Element).setPointerCapture?.(event.pointerId);
      setMode(nextMode);
    },
    [mouth.x, mouth.y, eyes],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!mode) return;
      const rect = pictureRef.current?.getBoundingClientRect();
      if (!rect) return;

      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      if (mode === "eyes-move" && eyes) {
        onEyesChange({
          ...eyes,
          x: clamp(pointerX / rect.width - grabOffset.current.x, 0.05, 0.95),
          y: clamp(pointerY / rect.height - grabOffset.current.y, 0.04, 0.94),
        });
        return;
      }

      if (eyes && (mode === "eyes-resize" || mode === "eyes-rotate")) {
        const centreX = eyes.x * rect.width;
        const centreY = eyes.y * rect.height;
        const dx = pointerX - centreX;
        const dy = pointerY - centreY;

        if (mode === "eyes-rotate") {
          // The handle sits above the pair, so straight up is zero degrees.
          const degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
          onEyesChange({ ...eyes, rotation: clamp(Math.round(degrees), -45, 45) });
          return;
        }

        // Undo the tilt before measuring, or dragging a rotated pair resizes it
        // along the wrong axes.
        const angle = toRadians(-eyes.rotation);
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);

        onEyesChange({
          ...eyes,
          // Horizontal distance sets how far apart they sit, vertical sets size.
          spacing: clamp((2 * Math.abs(localX)) / rect.width, 0.06, 0.7),
          radius: clamp((Math.abs(localY) / rect.height) * aspectRatio, 0.02, 0.16),
        });
        return;
      }

      if (mode === "mouth-move") {
        onMouthChange({
          ...mouth,
          x: clamp(pointerX / rect.width - grabOffset.current.x, 0.02, 0.98),
          y: clamp(pointerY / rect.height - grabOffset.current.y, 0.02, 0.98),
        });
        return;
      }

      const centreX = mouth.x * rect.width;
      const centreY = mouth.y * rect.height;
      const dx = pointerX - centreX;
      const dy = pointerY - centreY;

      if (mode === "mouth-rotate") {
        // The handle sits above the mouth, so straight up is zero degrees.
        const degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        onMouthChange({ ...mouth, rotation: clamp(Math.round(degrees), -45, 45) });
        return;
      }

      // Resize: undo the current rotation first, or dragging a rotated mouth
      // grows it along the wrong axes.
      const angle = toRadians(-mouth.rotation);
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle);

      onMouthChange({
        ...mouth,
        width: clamp((2 * Math.abs(localX)) / rect.width, 0.04, 0.6),
        height: clamp((2 * Math.abs(localY)) / rect.height, 0.02, 0.4),
      });
    },
    [mode, mouth, eyes, aspectRatio, onMouthChange, onEyesChange],
  );

  const endDrag = useCallback(() => setMode(null), []);

  return (
    <div className="editor">
      <div
        ref={pictureRef}
        className="picture editor-picture"
        style={{ aspectRatio: String(aspectRatio) }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img src={imageUrl} alt="Your uploaded picture" draggable={false} />

        {eyes && (
          <>
            <svg
              className="eyes-overlay"
              viewBox={`0 0 1000 ${viewHeight}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <g
                transform={`rotate(${eyes.rotation} ${(eyes.x * 1000).toFixed(1)} ${(eyes.y * viewHeight).toFixed(1)})`}
              >
                {[0, 1].map((index) => {
                  const cx =
                    (eyes.x + (index === 0 ? -eyes.spacing / 2 : eyes.spacing / 2)) * 1000;
                  const cy = eyes.y * viewHeight;
                  const r = eyes.radius * 1000;
                  return (
                    <g key={index}>
                      <ellipse
                        cx={cx}
                        cy={cy}
                        rx={r}
                        ry={r * 1.12}
                        fill="#fffdf7"
                        stroke="#3a3128"
                        strokeWidth={r * 0.14}
                      />
                      <circle cx={cx} cy={cy} r={r * 0.44} fill="#231f1a" />
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Drag target over the eye pair, with resize and rotate handles. */}
            <div
              className={`eyes-hit${mode?.startsWith("eyes") ? " eyes-hit-active" : ""}`}
              style={{
                left: `${eyes.x * 100}%`,
                top: `${eyes.y * 100}%`,
                width: `${(eyes.spacing + eyes.radius * 2) * 100}%`,
                height: `${eyes.radius * 2.4 * aspectRatio * 100}%`,
                transform: `translate(-50%, -50%) rotate(${eyes.rotation}deg)`,
              }}
              onPointerDown={beginDrag("eyes-move")}
            >
              <span
                className="handle handle-rotate"
                onPointerDown={beginDrag("eyes-rotate")}
                title="Tilt the eyes"
              />
              <span
                className="handle handle-resize"
                onPointerDown={beginDrag("eyes-resize")}
                title="Eye spacing and size"
              />
            </div>
          </>
        )}

        <div
          className={`mouth editor-mouth${mode?.startsWith("mouth") ? " editor-mouth-active" : ""}`}
          style={{
            left: `${mouth.x * 100}%`,
            top: `${mouth.y * 100}%`,
            width: `${mouth.width * 100}%`,
            height: `${mouth.height * 100}%`,
            transform: `translate(-50%, -50%) rotate(${mouth.rotation}deg)`,
          }}
          onPointerDown={beginDrag("mouth-move")}
        >
          {/* Partly open reads more clearly than a closed line. */}
          <MouthShape openness={0.4} />
          <span
            className="handle handle-rotate"
            onPointerDown={beginDrag("mouth-rotate")}
            title="Rotate"
          />
          <span
            className="handle handle-resize"
            onPointerDown={beginDrag("mouth-resize")}
            title="Resize"
          />
        </div>
      </div>

      <p className="editor-hint">
        വായയും കണ്ണുകളും വലിച്ചിടൂ · Drag the mouth and eyes into place. Corner
        handles resize, the top handle rotates the mouth.
      </p>
    </div>
  );
}
