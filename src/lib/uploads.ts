import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * File uploads, into Supabase Storage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  VALIDATED BY CONTENT, NEVER BY EXTENSION OR MIME TYPE (§9).
 *
 *  `file.type` comes from the browser and `file.name` comes from the user.
 *  Both are attacker-controlled. Trusting either is how a .php renamed to
 *  .jpg — or a .jpg whose bytes are a script — ends up served from our origin.
 *
 *  So every upload is sniffed: the first bytes must match a known image
 *  signature, and the extension we store is derived from THOSE BYTES, not
 *  from whatever the file was called.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS IS NO LONGER `writeFile(public/uploads/…)`
 *
 *  It used to be, and that works under XAMPP and nowhere else. On Vercel —
 *  and on any container that redeploys — the filesystem is READ-ONLY apart
 *  from an ephemeral /tmp that is never web-served, so `mkdir` threw EROFS and
 *  every upload on the platform failed.
 *
 *  Worse, and quieter: `public/uploads/*` is gitignored, so files uploaded
 *  before a deploy were not in the build at all. Their URLs stayed in the
 *  database and turned into 404s — a broken-image icon where the logo used to
 *  be, with nothing in any log to explain it. Migration 0016 clears those dead
 *  paths so the defaults render instead.
 *
 *  The bucket is PUBLIC, which is right for what goes in it: logos, dish
 *  photos, avatars — all of it is shown to anonymous visitors anyway. Writes
 *  are not public; they happen here, with the service-role key.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type UploadKind = "branding" | "avatars" | "restaurants" | "menu" | "appearance";

/**
 * Created by migration 0016.
 *
 * Exported so the health check can name the bucket it is looking for without
 * a second literal that could drift away from this one.
 */
export const UPLOAD_BUCKET = "assets";
const BUCKET = UPLOAD_BUCKET;

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Magic-byte signatures.
 *
 * SVG is deliberately absent. It is XML, it can carry <script>, and it would
 * be served from a domain we control — which makes an uploaded SVG a stored
 * XSS with extra steps. PNG covers every favicon case that matters.
 */
const SIGNATURES: { ext: string; mime: string; bytes: number[]; offset?: number }[] = [
  { ext: "png", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: "jpg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { ext: "gif", mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // WEBP is "RIFF....WEBP" — the tag sits at offset 8, after the size field.
  { ext: "webp", mime: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { ext: "ico", mime: "image/x-icon", bytes: [0x00, 0x00, 0x01, 0x00] },
];

function detect(buffer: Buffer): { ext: string; mime: string } | null {
  for (const signature of SIGNATURES) {
    const offset = signature.offset ?? 0;
    if (buffer.length < offset + signature.bytes.length) continue;

    const matches = signature.bytes.every((byte, i) => buffer[offset + i] === byte);
    if (matches) return { ext: signature.ext, mime: signature.mime };
  }
  return null;
}

export interface UploadResult {
  ok: true;
  /** Absolute public URL on the Supabase CDN. */
  url: string;
  mime: string;
  bytes: number;
}

export interface UploadError {
  ok: false;
  error: string;
}

export async function saveUpload(
  file: File,
  kind: UploadKind,
): Promise<UploadResult | UploadError> {
  if (!file || file.size === 0) return { ok: false, error: "No file received." };

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detect(buffer);

  if (!detected) {
    // Deliberately does not echo the claimed type back — the point is that we
    // did not believe it.
    return {
      ok: false,
      error:
        "That file is not a PNG, JPEG, GIF, WebP or ICO. The contents are checked, not the file name — SVG is not accepted because it can carry scripts.",
    };
  }

  // The object path comes from us, never from the upload. A user-supplied name
  // can contain traversal segments, null bytes, or a second extension.
  const objectPath = `${kind}/${crypto.randomUUID()}.${detected.ext}`;

  const supabase = createAdminClient();

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: detected.mime,
    // Every object has a UUID name, so a given URL's bytes never change and it
    // can be cached for a year. Replacing an image produces a NEW url, which
    // is also why no cache-busting query string is needed anywhere.
    cacheControl: "31536000",
    // Never overwrite. With a random name a collision means something is very
    // wrong, and silently replacing someone else's file would be worse.
    upsert: false,
  });

  if (error) {
    console.error("[upload] storage rejected the object", error.message);
    return {
      ok: false,
      error:
        "Could not store the file. If this is a fresh deployment, check that migration 0016 has been run — it creates the storage bucket.",
    };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);

  return { ok: true, url: publicUrl, mime: detected.mime, bytes: buffer.length };
}

/**
 * Remove a previously stored object, given the public URL we handed out.
 *
 * Best-effort by design: callers use it to tidy up after replacing an image,
 * and a failure here must never fail the operation that succeeded. An orphaned
 * object costs a fraction of a cent; a failed save costs the user their work.
 */
export async function deleteUpload(publicUrl: string | null | undefined): Promise<void> {
  if (!publicUrl) return;

  // Only ever delete things that look like ours. A URL from anywhere else —
  // including the Unsplash defaults — must not reach a delete call.
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return;

  const objectPath = publicUrl.slice(index + marker.length);
  if (!objectPath) return;

  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
  if (error) console.warn("[upload] could not remove", objectPath, error.message);
}
