"use client";

import { useRef, useState } from "react";
import { ImageOff, Loader2, Trash2, Undo2, Upload } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import { isNativeApp } from "@/lib/capacitor/native";

/**
 * A file picker that PREVIEWS ONLY. It never talks to the server.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  CHOOSING IS NOT SAVING.
 *
 *  Earlier this uploaded the moment you picked a file, which made it the one
 *  control on the settings page that ignored the Save button — you could pick
 *  a logo, press Discard, and still have changed the logo.
 *
 *  Now the parent holds the chosen File and sends it on Save alongside
 *  everything else. This component owns nothing but the picker and the
 *  preview, so there is no second copy of the truth to go stale.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The preview uses a plain <img>. next/image would optimise it, but a blob:
 * URL has no dimensions we know and no remote pattern to configure.
 */

/** Mirrors MAX_BYTES in lib/uploads. The server still enforces it. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Longest edge kept. A dish photo is shown at most ~600 CSS px wide (1 200
 * device px on a dense phone); a cover a little wider. 1 280 covers both.
 */
const MAX_EDGE = 1280;

/**
 * Below this, an image that needs no resizing is left exactly as chosen: the
 * bytes saved would be a few kilobytes, bought with a generation of JPEG loss.
 */
const LEAVE_ALONE_BYTES = 300 * 1024;

function megabytes(bytes: number): string {
  // Never "0.0 Mo" for a small, well-compressed photo.
  return Math.max(0.1, bytes / 1024 / 1024).toFixed(1);
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Optimise an image in the browser, before it is ever uploaded.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WITHOUT THIS, THE FEATURE DOES NOT WORK FOR ITS ACTUAL USERS.
 *
 *  The people adding dish photos are standing in a kitchen with a phone. A
 *  modern phone camera produces 3–6 MB files, so a hard 2 MB rule rejects
 *  essentially every real photograph and the answer "use a smaller image" is
 *  not one a restaurateur can act on.
 *
 *  A dish photo is displayed a few hundred pixels wide. Sending twelve
 *  megapixels of it costs the manager their mobile data to upload and every
 *  customer theirs to download, for no visible difference.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT NOW OPTIMISES EVERY PHOTO, NOT ONLY THE ONES OVER 2 MB.
 *
 *  A 1.9 MB, 4 000 px photo used to pass straight through — and then every
 *  customer scrolling the menu downloaded 1.9 MB for a 300 px thumbnail,
 *  on prepaid data. We do not run server-side image transforms (they are
 *  billed per image), so the browser that picks the file is the one place
 *  to fix it: downscale to MAX_EDGE, re-encode, and keep the result ONLY if
 *  it is actually smaller than what was chosen.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WebP first (≈30% smaller than JPEG at the same quality, and it keeps a
 * logo's transparency). A browser that cannot encode WebP silently hands back
 * a PNG from toBlob, so the returned type is checked and JPEG — or PNG, for a
 * PNG source, so transparency never turns black — is the fallback.
 *
 * Left untouched: GIFs (re-encoding would drop the animation), icons, and a
 * small image that needs no resizing (see LEAVE_ALONE_BYTES).
 *
 * Every failure path returns the original file. The server validates by magic
 * bytes regardless, so the worst case is the size error the user would have
 * seen anyway — never a corrupted upload.
 */
async function optimiseImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/x-icon" || file.type === "image/svg+xml") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= LEAVE_ALONE_BYTES) {
      bitmap.close();
      return file;
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const isPng = file.type === "image/png";
    let best: Blob | null = null;

    for (const quality of [0.8, 0.7, 0.55]) {
      let blob = await encode(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") {
        // No WebP encoder (older Safari). PNG sources stay PNG — lossless, so
        // one attempt is enough — everything else becomes JPEG.
        blob = isPng ? await encode(canvas, "image/png") : await encode(canvas, "image/jpeg", quality);
      }
      if (blob && (!best || blob.size < best.size)) best = blob;
      if (best && best.size <= MAX_BYTES) break;
    }

    // Only ever trade the original for something smaller.
    if (!best || best.size >= file.size) return file;

    // The name is cosmetic — saveUpload names the file itself from the bytes
    // it sniffs, because a user-supplied name is attacker-controlled.
    const extension = best.type === "image/webp" ? "webp" : best.type === "image/png" ? "png" : "jpg";
    return new File([best], `image.${extension}`, { type: best.type });
  } catch {
    return file;
  }
}

export function ImageUpload({
  label,
  hint,
  shape = "square",
  previewUrl,
  dirty = false,
  disabled = false,
  onSelect,
  onRemove,
  onUndo,
}: {
  label: string;
  hint?: string;
  shape?: "square" | "circle" | "wide";
  /** What to show: the pending blob: URL if one exists, else the saved value. */
  previewUrl: string | null;
  /** True when an unsaved choice (or removal) is waiting on Save. */
  dirty?: boolean;
  disabled?: boolean;
  onSelect: (file: File) => void;
  /** Marks the current image for removal. Applied on Save, like everything else. */
  onRemove?: () => void;
  /** Throws away a pending choice without touching what is already saved. */
  onUndo?: () => void;
}) {
  const { t, locale } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function pick(file: File) {
    setError(null);
    setNote(null);
    setWorking(true);

    const prepared = await optimiseImage(file);
    setWorking(false);

    if (prepared.size > MAX_BYTES) {
      setError(
        t("common.img.tooLarge", { size: megabytes(prepared.size), limit: megabytes(MAX_BYTES) }),
      );
      return;
    }

    // Said out loud rather than done silently: someone who uploaded a careful
    // photo deserves to know it was resized before it reached the menu.
    if (prepared !== file) {
      setNote(t("common.img.shrunk", { size: megabytes(prepared.size) }));
    }

    onSelect(prepared);
  }

  const busy = disabled || working;

  async function chooseImage() {
    if (!isNativeApp()) { inputRef.current?.click(); return; }
    setWorking(true);
    setError(null);
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        source: CameraSource.Prompt, resultType: CameraResultType.Base64,
        width: MAX_EDGE, height: MAX_EDGE, quality: 82, correctOrientation: true,
        saveToGallery: false,
        promptLabelHeader: label,
        promptLabelPhoto: locale === "fr" ? "Photothèque" : "Photo library",
        promptLabelPicture: locale === "fr" ? "Prendre une photo" : "Take a photo",
        promptLabelCancel: locale === "fr" ? "Annuler" : "Cancel",
      });
      if (!photo.base64String) return;
      const bytes = Uint8Array.from(atob(photo.base64String), (char) => char.charCodeAt(0));
      await pick(new File([bytes], `photo.${photo.format}`, { type: `image/${photo.format}` }));
    } catch (cause) {
      if (!/cancel/i.test(String(cause))) setError(locale === "fr"
        ? "Impossible d'ouvrir la photo. Vérifiez l'autorisation de l'appareil photo dans les réglages."
        : "Could not open the photo. Check camera permission in device settings.");
    } finally { setWorking(false); }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">{label}</p>
        {dirty && <Badge tone="warning">{t("common.img.notSaved")}</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden border bg-surface-2",
            dirty ? "border-warning border-dashed" : "border-border",
            shape === "circle" && "size-20 rounded-full",
            shape === "square" && "size-20 rounded-lg",
            shape === "wide" && "aspect-video w-40 rounded-lg",
          )}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="size-full object-contain" />
          ) : (
            <ImageOff className="size-6 text-text-light" aria-hidden />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
              // Reset so choosing the same file twice still fires a change.
              e.target.value = "";
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void chooseImage()}
            >
              {working ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-3.5" aria-hidden />
              )}
              <span>
                {working
                  ? t("common.img.working")
                  : previewUrl
                    ? t("common.img.replace")
                    : t("common.img.choose")}
              </span>
            </Button>

            {dirty && onUndo && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onUndo}>
                <Undo2 className="size-3.5" aria-hidden />
                <span>{t("common.img.undo")}</span>
              </Button>
            )}

            {previewUrl && onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                className="text-error hover:bg-error-light"
                onClick={onRemove}
              >
                <Trash2 className="size-3.5" aria-hidden />
                <span>{t("common.img.remove")}</span>
              </Button>
            )}
          </div>

          {hint && <p className="max-w-xs text-xs text-text-light">{hint}</p>}
          {note && <p className="max-w-xs text-xs font-medium text-success">{note}</p>}
          {error && (
            <p role="alert" className="max-w-xs text-xs font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
