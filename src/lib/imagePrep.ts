/**
 * Image validation and resizing, done in the browser before upload.
 *
 * Resizing locally keeps the request small and the analysis fast, and means a
 * 12 MP phone photo does not travel over the wire for no benefit.
 */

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Generous enough for any phone photo, small enough to reject nonsense. */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** Longest edge after resizing. The vision model gains nothing from more. */
const MAX_EDGE = 1024;

export interface PreparedImage {
  /** JPEG data URL, ready to send and to display. */
  dataUrl: string;
  width: number;
  height: number;
  /** width / height, used to keep the mouth locked to the picture. */
  aspectRatio: number;
}

export class ImagePrepError extends Error {}

function loadImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new ImagePrepError("That file could not be decoded as an image."));
    image.src = objectUrl;
  });
}

/**
 * Load a bundled example image and prepare it like an upload.
 *
 * Exists so a demo does not involve hunting through a file picker on stage.
 * SVG examples work too: the browser rasterises them into the canvas, so what
 * reaches the vision model is a normal JPEG either way.
 */
export async function prepareFromUrl(url: string): Promise<PreparedImage> {
  const image = await loadImage(url);
  // Same-origin, so the canvas is not tainted and toDataURL still works.
  return drawToDataUrl(
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImagePrepError(
      `${file.type || "That file"} is not supported. Use a JPEG, PNG or WebP image.`,
    );
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImagePrepError("That image is over 20 MB. Try a smaller one.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    return drawToDataUrl(image, image.naturalWidth, image.naturalHeight);
  } finally {
    // Always released, including on the error path, so we do not leak blobs.
    URL.revokeObjectURL(objectUrl);
  }
}

/** Shared by file upload and camera capture. */
export function drawToDataUrl(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): PreparedImage {
  if (!sourceWidth || !sourceHeight) {
    throw new ImagePrepError("That image has no dimensions.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImagePrepError("Your browser refused to prepare the image.");

  ctx.drawImage(source, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.85),
    width,
    height,
    aspectRatio: width / height,
  };
}
