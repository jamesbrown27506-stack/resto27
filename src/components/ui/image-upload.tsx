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

/** Longest edge kept when an image has to be shrunk. */
const MAX_EDGE = 1600;

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * Shrink an oversized image in the browser, before it is ever uploaded.
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
 * A file already under the limit is returned UNTOUCHED — no silent
 * re-encoding, no generation loss on an image that was already fine.
 *
 * PNG stays PNG: it is what logos and favicons arrive as, and re-encoding one
 * to JPEG replaces its transparency with black. Everything else becomes JPEG,
 * stepping the quality down until it fits.
 *
 * Every failure path returns the original file. The server validates by magic
 * bytes regardless, so the worst case is the size error the user would have
 * seen anyway — never a corrupted upload.
 */
async function shrinkIfNeeded(file: File): Promise<File> {
  if (file.size <= MAX_BYTES) return file;
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const keepPng = file.type === "image/png";
    const attempts: (number | undefined)[] = keepPng ? [undefined] : [0.85, 0.7, 0.55];

    for (const quality of attempts) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, keepPng ? "image/png" : "image/jpeg", quality),
      );
      if (blob && blob.size <= MAX_BYTES) {
        // The name is cosmetic — saveUpload names the file itself from the
        // bytes it sniffs, because a user-supplied name is attacker-controlled.
        return new File([blob], keepPng ? "image.png" : "image.jpg", { type: blob.type });
      }
    }

    return file;
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

    const prepared = await shrinkIfNeeded(file);
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
