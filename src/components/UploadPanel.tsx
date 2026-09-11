import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCEPTED_TYPES,
  drawToDataUrl,
  ImagePrepError,
  prepareFromUrl,
  prepareImage,
  type PreparedImage,
} from "../lib/imagePrep";

interface Props {
  onImage: (image: PreparedImage) => void;
  onUseChair: () => void;
  disabled?: boolean;
}

/**
 * One-tap demo subjects, so presenting does not involve a file picker.
 *
 * Narrowed to artwork with a subject that can plausibly speak. The appam and the
 * chair were here to show that anything could talk, but a cartoon mouth pasted
 * onto an object is the weakest version of the idea, so they are no longer what
 * the app leads with.
 */
const EXAMPLES = [
  { url: "/examples/mona-lisa.jpg", label: "മോണാലിസ", hint: "recognises the painting" },
];

export function UploadPanel({ onImage, onUseChair, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState("");

  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  // Releasing the camera on unmount matters: otherwise the recording light
  // stays on after the component goes away.
  useEffect(() => stopCamera, [stopCamera]);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError("");
      try {
        onImage(await prepareImage(file));
      } catch (err) {
        setError(
          err instanceof ImagePrepError ? err.message : "Could not read that image.",
        );
      }
    },
    [onImage],
  );

  const loadExample = useCallback(
    async (url: string) => {
      setError("");
      try {
        onImage(await prepareFromUrl(url));
      } catch {
        setError("Could not load that example. Upload a photo instead.");
      }
    },
    [onImage],
  );

  const openCamera = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      setCameraOpen(true);
      // The element only exists after the state flip, so attach next tick.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("Could not open the camera. Check permissions, or upload a photo instead.");
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const image = drawToDataUrl(video, video.videoWidth, video.videoHeight);
      stopCamera();
      onImage(image);
    } catch (err) {
      setError(err instanceof ImagePrepError ? err.message : "Capture failed.");
    }
  }, [onImage, stopCamera]);

  return (
    <div className="upload">
      {cameraOpen ? (
        <div className="camera">
          <video ref={videoRef} playsInline muted />
          <div className="camera-actions">
            <button className="btn btn-primary" onClick={capture}>
              Capture
            </button>
            <button className="btn btn-quiet" onClick={stopCamera}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="upload-actions">
            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              ചിത്രം തിരഞ്ഞെടുക്കൂ · Upload photo
            </button>
            <button className="btn" onClick={openCamera} disabled={disabled}>
              ഫോട്ടോ എടുക്കൂ · Take photo
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            hidden
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              // Reset so picking the same file twice still fires a change.
              event.target.value = "";
            }}
          />

          <div className="examples">
            <span>അല്ലെങ്കിൽ ഇത് · or try this one</span>
            <div className="example-row">
              {EXAMPLES.map((example) => (
                <button
                  key={example.url}
                  className="example-btn"
                  disabled={disabled}
                  onClick={() => void loadExample(example.url)}
                >
                  <img src={example.url} alt="" aria-hidden="true" />
                  <strong>{example.label}</strong>
                  <em>{example.hint}</em>
                </button>
              ))}
            </div>
          </div>

          <button className="link-btn" onClick={onUseChair} disabled={disabled}>
            skip straight to the demo chair
          </button>
        </>
      )}

      {error && <p className="upload-error">{error}</p>}
    </div>
  );
}
