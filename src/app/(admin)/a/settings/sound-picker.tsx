"use client";

import { useRef, useState, useTransition } from "react";
import { Trash2, Upload, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { uploadNotificationSound } from "@/lib/data/profile-actions";
import {
  BUILT_IN_SOUNDS,
  DEFAULT_SOUND,
  isCustomSound,
  notificationSoundUrl,
} from "@/lib/notification-sound";
import { cn } from "@/lib/utils";

/**
 * The platform notification sound: pick one of the six that ship, or upload
 * your own.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE UPLOAD SAVES ITSELF. THE DROPDOWN DOES NOT.
 *
 *  Everything else on this screen is a draft you commit with the page's Save
 *  button, and choosing a built-in sound stays that way — it is a string in
 *  the same draft as every other string.
 *
 *  A file cannot live in that draft: `draft` is a Record<string, string>, and
 *  the branding pickers on this very page carry a comment explaining what
 *  happened the last time a file was smuggled into it (a phantom unsaved
 *  change that overwrote the real URL on the next Save). So an upload is its
 *  own transaction, exactly like the logo: it stores the object, writes
 *  `notification_sound`, and tells the parent so the dropdown stops arguing
 *  with what is now stored.
 *
 *  PREVIEW BEFORE COMMITTING is the point of the play button next to it. This
 *  sound fires on every order across the whole platform; hearing it once
 *  before it becomes everyone's is the difference between a chime and a
 *  fortnight of complaints.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function SoundPicker({
  value,
  onChange,
}: {
  /** The current draft value — a built-in name, or an uploaded file's URL. */
  value: string;
  /** Report a new value up: a picked built-in, or a freshly uploaded URL. */
  onChange: (value: string) => void;
}) {
  const { toast } = useToast();
  const [uploading, startUpload] = useTransition();
  const [playing, setPlaying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const custom = isCustomSound(value);
  const selected = custom ? "" : (value || DEFAULT_SOUND);

  function preview() {
    setPlaying(true);
    const audio = new Audio(notificationSoundUrl(value));
    audio.volume = 0.6;
    audio.addEventListener("ended", () => setPlaying(false), { once: true });
    void audio.play().catch(() => {
      setPlaying(false);
      toast(
        custom
          ? "The uploaded sound could not be played — the file may not have stored correctly."
          : "That sound file is missing from public/sounds.",
        "error",
      );
    });
  }

  function upload(file: File) {
    startUpload(async () => {
      const form = new FormData();
      form.append("file", file);
      const result = await uploadNotificationSound(form);
      if (!result.ok || !result.url) {
        toast(result.error ?? "The sound could not be uploaded.", "error");
        return;
      }
      onChange(result.url);
      toast("Sound uploaded — it is now the platform notification sound.", "success");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          id="set-notification_sound"
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 rounded-md border border-border bg-bg px-3 text-sm"
        >
          {BUILT_IN_SOUNDS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
          {/* Only selectable by uploading — picking it from the list would
              mean "use the custom sound" with no custom sound to use. */}
          {custom && <option value="">Uploaded sound</option>}
        </select>

        <Button type="button" variant="outline" size="sm" disabled={playing} onClick={preview}>
          <Volume2 className="size-4" aria-hidden />
          <span>Preview</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={uploading}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          <span>Upload a sound</span>
        </Button>

        {custom && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading}
            onClick={() => onChange(DEFAULT_SOUND)}
            title="Go back to a built-in sound"
          >
            <Trash2 className="size-4" aria-hidden />
            <span>Use a built-in</span>
          </Button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="audio/wav,audio/mpeg,audio/ogg,audio/mp4,.wav,.mp3,.ogg,.m4a"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset first: picking the same file twice must fire again.
            e.target.value = "";
            if (file) upload(file);
          }}
        />
      </div>

      {custom && (
        <p
          className={cn(
            "truncate rounded-md bg-surface-2 px-3 py-2 font-mono text-[10px] text-text-light",
          )}
          title={value}
        >
          {value}
        </p>
      )}

      <p className="text-xs leading-relaxed text-text-light">
        WAV, MP3, OGG or M4A, up to 1 MB — a second or two is right, because this plays on every
        order and downloads in every signed-in tab. The file is checked by its contents, not its
        name. Uploading saves immediately; choosing a built-in is saved with the button below.
      </p>
    </div>
  );
}
