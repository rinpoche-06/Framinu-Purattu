import { useEffect, useRef } from "react";
import { MouthAnimator } from "../lib/mouth";
import { mouthGeometry } from "../lib/mouthShape";
import {
  BlinkController,
  EnvelopeFollower,
  GazeController,
  Spring,
  watchReducedMotion,
} from "../lib/motion";
import type { EyePlacement, MouthPlacement } from "../lib/placement";
import type { SessionState } from "../lib/realtime";

export interface AudioSource {
  /** RMS of what is currently reaching the speakers. 0 when silent. */
  getLevel: () => number;
  isPlaying: () => boolean;
}

interface Props {
  imageUrl: string;
  label: string;
  aspectRatio: number;
  mouth: MouthPlacement;
  /** null hides the cartoon eyes, for pictures that already have their own. */
  eyes: EyePlacement | null;
  escaping: boolean;
  sessionState: SessionState;
  audio: AudioSource;
}

/**
 * The talking picture.
 *
 * Everything continuous — mouth, blink, gaze, body motion — is animated inside
 * one requestAnimationFrame loop that writes straight to DOM attributes. No
 * React state is involved, because these values change every frame and nothing
 * else in the tree depends on them.
 *
 * Layering matters here:
 *   .picture        clips, never transformed
 *     .picture-shake  CSS escape animation
 *       .picture-layer JS transform, holds image + eyes + mouth together
 *
 * The features live inside the transformed layer so they stay locked to the
 * image. Transforming the picture itself would break the clipping, and putting
 * the escape animation on the same element as the JS transform would mean CSS
 * and JS fighting over the same property.
 */
export function PictureStage({
  imageUrl,
  label,
  aspectRatio,
  mouth,
  eyes,
  escaping,
  sessionState,
  audio,
}: Props) {
  const pictureRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const strokeRef = useRef<SVGPathElement>(null);
  const interiorRef = useRef<SVGEllipseElement>(null);
  const leftEyeRef = useRef<SVGGElement>(null);
  const rightEyeRef = useRef<SVGGElement>(null);
  const leftPupilRef = useRef<SVGCircleElement>(null);
  const rightPupilRef = useRef<SVGCircleElement>(null);

  // Read through refs so the animation loop never needs re-creating when these
  // change. Restarting the loop mid-speech would visibly hitch the mouth.
  const stateRef = useRef(sessionState);
  stateRef.current = sessionState;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const eyesRef = useRef(eyes);
  eyesRef.current = eyes;

  const viewHeight = Math.round(1000 / aspectRatio);

  useEffect(() => {
    const mouthAnimator = new MouthAnimator();
    const blink = new BlinkController();
    const gaze = new GazeController();
    const envelope = new EnvelopeFollower();
    const lean = new Spring(0, 60, 13);
    const tiltX = new Spring(0, 55, 12);
    const tiltY = new Spring(0, 55, 12);

    let reducedMotion = false;
    const stopWatching = watchReducedMotion((reduced) => {
      reducedMotion = reduced;
      if (reduced && layerRef.current) layerRef.current.style.transform = "";
    });

    const onPointerMove = (event: PointerEvent) => {
      const rect = pictureRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      // Normalised to roughly -1..1 across a region wider than the picture, so
      // the eyes keep tracking after the pointer leaves the frame.
      const nx = ((event.clientX - (rect.left + rect.width / 2)) / rect.width) * 1.6;
      const ny = ((event.clientY - (rect.top + rect.height / 2)) / rect.height) * 1.6;
      gaze.setPointer(nx, ny, performance.now() / 1000);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 1 / 20);
      previous = now;
      const seconds = now / 1000;

      const state = stateRef.current;
      const level = audioRef.current.getLevel();
      const speaking = audioRef.current.isPlaying();

      // Stepped exactly once per frame. Both the eyes and the body tilt read
      // from it, and stepping it twice would integrate the spring at double
      // rate and skew the idle saccade timing.
      const look = gaze.step(seconds, dt);

      // --- mouth: fast, per syllable -----------------------------------
      const openness = mouthAnimator.update(level, speaking);
      const geometry = mouthGeometry(openness);
      outlineRef.current?.setAttribute("d", geometry.outline);
      strokeRef.current?.setAttribute("d", geometry.outline);
      if (interiorRef.current) {
        interiorRef.current.setAttribute("cy", geometry.interior.cy.toFixed(2));
        interiorRef.current.setAttribute("rx", geometry.interior.rx.toFixed(2));
        interiorRef.current.setAttribute("ry", geometry.interior.ry.toFixed(2));
        interiorRef.current.setAttribute("opacity", String(geometry.interior.opacity));
      }

      // --- eyes ---------------------------------------------------------
      const placement = eyesRef.current;
      if (placement) {
        const lidOpen = blink.step(seconds);
        const radius = placement.radius * 1000;
        const cy = placement.y * viewHeight;
        const centres = [
          (placement.x - placement.spacing / 2) * 1000,
          (placement.x + placement.spacing / 2) * 1000,
        ];
        const maxOffset = radius * 0.36;

        const groups = [leftEyeRef.current, rightEyeRef.current];
        const pupils = [leftPupilRef.current, rightPupilRef.current];

        for (let i = 0; i < 2; i++) {
          // Squash the whole eye vertically about its own centre: reads as a
          // blink without needing a separate eyelid shape.
          groups[i]?.setAttribute(
            "transform",
            `translate(${centres[i].toFixed(1)} ${cy.toFixed(1)}) scale(1 ${lidOpen.toFixed(3)}) translate(${(-centres[i]).toFixed(1)} ${(-cy).toFixed(1)})`,
          );
          pupils[i]?.setAttribute("cx", (centres[i] + look.x * maxOffset).toFixed(1));
          pupils[i]?.setAttribute("cy", (cy + look.y * maxOffset * 0.7).toFixed(1));
        }
      }

      // --- body: slow, per phrase --------------------------------------
      if (layerRef.current && !reducedMotion) {
        // Deliberately a much slower follower than the mouth. Matching their
        // time constants makes the whole picture look like a vibrating puppet.
        const phrase = envelope.step(speaking ? Math.min(1, level / 0.12) : 0);

        const leanTarget = state === "listening" ? 1 : 0;
        const leanValue = lean.step(leanTarget, dt);
        const rollTarget = state === "thinking" ? 1.2 : 0;

        const rotateY = tiltX.step(look.x, dt) * 3.4;
        const rotateX = tiltY.step(look.y, dt) * -2.6;

        const breath = Math.sin(seconds * 0.55) * 0.004;
        const sway = Math.sin(seconds * 0.31) * 0.35 + rollTarget;
        const nod = -phrase * 0.9;
        // Base scale gives headroom so tilt and sway never expose frame edges.
        const scale = 1.035 + breath + leanValue * 0.008 + phrase * 0.012;

        layerRef.current.style.transform =
          `perspective(950px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)` +
          ` rotate(${sway.toFixed(2)}deg) translateY(${nod.toFixed(2)}%) scale(${scale.toFixed(4)})`;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      stopWatching();
    };
  }, [viewHeight]);

  const initial = mouthGeometry(0);

  return (
    <div className="frame">
      <div className="frame-inner">
        <div
          ref={pictureRef}
          className="picture"
          style={{ aspectRatio: String(aspectRatio) }}
        >
          <div className={`picture-shake${escaping ? " picture-escaping" : ""}`}>
            <div ref={layerRef} className="picture-layer">
              <img src={imageUrl} alt={label} draggable={false} />

              {eyes && (
                <svg
                  className="eyes-overlay"
                  viewBox={`0 0 1000 ${viewHeight}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {/*
                    Rotation is applied to a wrapper about the pair's midpoint, so
                    the two eyes tilt together. It must sit outside the per-eye
                    groups, which are reserved for the blink transform.
                  */}
                  <g
                    transform={`rotate(${eyes.rotation} ${(eyes.x * 1000).toFixed(1)} ${(eyes.y * viewHeight).toFixed(1)})`}
                  >
                    {[0, 1].map((index) => {
                      const cx =
                        (eyes.x + (index === 0 ? -eyes.spacing / 2 : eyes.spacing / 2)) * 1000;
                      const cy = eyes.y * viewHeight;
                      const r = eyes.radius * 1000;
                      return (
                        <g
                          key={index}
                          ref={index === 0 ? leftEyeRef : rightEyeRef}
                          className="eye"
                        >
                          <ellipse
                            cx={cx}
                            cy={cy}
                            rx={r}
                            ry={r * 1.12}
                            fill="#fffdf7"
                            stroke="#3a3128"
                            strokeWidth={r * 0.14}
                          />
                          <circle
                            ref={index === 0 ? leftPupilRef : rightPupilRef}
                            cx={cx}
                            cy={cy}
                            r={r * 0.44}
                            fill="#231f1a"
                          />
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}

              <div
                className="mouth"
                style={{
                  left: `${mouth.x * 100}%`,
                  top: `${mouth.y * 100}%`,
                  width: `${mouth.width * 100}%`,
                  height: `${mouth.height * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${mouth.rotation}deg)`,
                }}
              >
                <svg
                  className="mouth-svg"
                  viewBox="0 0 100 60"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path ref={outlineRef} d={initial.outline} fill="#2a1512" />
                  <path
                    ref={strokeRef}
                    d={initial.outline}
                    fill="none"
                    stroke="#0f0908"
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  <ellipse ref={interiorRef} cx={50} cy={30} rx={0} ry={0} fill="#b3453f" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="frame-caption">{label}</p>
    </div>
  );
}
