/**
 * Remembers the current picture across a page reload.
 *
 * Why: all of this lived in React state, so any reload — an accidental refresh,
 * or the Vite dev server restarting — threw away the upload, the generated
 * personality and the mouth placement, dropping you back to the landing screen.
 * Mid-demo that means re-uploading and re-positioning under pressure.
 *
 * Redis persists the character card server-side, but the browser was forgetting
 * which card it was using, so that persistence was unreachable after a reload.
 * This is the missing half.
 *
 * sessionStorage rather than localStorage on purpose: the snapshot should live
 * as long as the tab does, not forever. Uploaded images are not something to
 * leave lying around on someone's machine.
 */

import type { EyePlacement, MouthPlacement } from "./placement";

const KEY = "framinu.session.v1";

/**
 * Roughly 4 MB, under the usual 5 MB sessionStorage ceiling. A resized upload is
 * a few hundred KB, so this only trips on something pathological.
 */
const MAX_BYTES = 4_000_000;

export interface SessionSnapshot {
  /** Server-side id. May be forgotten by the server; the card covers that. */
  characterId?: string;
  /**
   * Identifies the conversation, so a reload resumes the same one and the
   * character still remembers what was said rather than only which picture.
   */
  conversationId?: string;
  label: string;
  /** Data URL, so the picture survives without needing the original file. */
  imageUrl: string;
  aspectRatio: number;
  mouth: MouthPlacement;
  eyes: EyePlacement;
  showEyes: boolean;
  voice: "male" | "female";
  roast: "savage" | "normal";
  /**
   * The full card, so a reload can re-register the character even if the server
   * has forgotten it and Redis is unavailable.
   */
  card?: unknown;
}

export function saveSnapshot(snapshot: SessionSnapshot): void {
  try {
    const serialised = JSON.stringify(snapshot);
    if (serialised.length > MAX_BYTES) return;
    sessionStorage.setItem(KEY, serialised);
  } catch {
    // Quota exceeded, or storage blocked in private mode. Losing the snapshot is
    // a minor inconvenience, so it must never surface as an error.
  }
}

export function loadSnapshot(): SessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SessionSnapshot;

    // Written by an older build, or hand-edited. Validate the fields we rely on
    // rather than rendering something broken.
    // Uploads and examples become data URLs; the built-in chair is a same-origin
    // path. Anything else did not come from us.
    const validImage =
      typeof parsed?.imageUrl === "string" &&
      (parsed.imageUrl.startsWith("data:") || parsed.imageUrl.startsWith("/"));

    if (
      !validImage ||
      typeof parsed.aspectRatio !== "number" ||
      !parsed.mouth ||
      !parsed.eyes
    ) {
      clearSnapshot();
      return null;
    }

    return parsed;
  } catch {
    clearSnapshot();
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do.
  }
}
