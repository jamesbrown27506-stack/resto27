import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { getCurrentProfile, getSessionUser } from "@/lib/auth/session";
import { hasVerifiedMailbox } from "@/lib/auth/security-rules";
import { emailVerificationRequired } from "@/lib/auth/email-policy";
import { rateLimit } from "@/lib/rate-limit";

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

export type UploadKind =
  | "branding"
  | "avatars"
  | "restaurants"
  | "menu"
  | "appearance"
  | "reviews"
  | "sounds";

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

/**
 * Why an image was refused — a stable code, so the customer- and
 * restaurant-facing actions can answer in the reader's language. `error` stays
 * the English sentence the admin area shows as-is.
 */
export type UploadRejection = "empty" | "tooLarge" | "notImage" | "storageFailed" | "quota" | "verification";

export interface UploadError {
  ok: false;
  error: string;
  reason?: UploadRejection;
  /** Size in MB, one decimal, for the `tooLarge` message. */
  sizeMb?: string;
}

/**
 * The rejection in the viewer's language, for everything outside the admin
 * area. Falls back to the English `error` for a result without a code (the
 * audio path, which only the admin uses).
 */
export function localizeUploadError(
  result: UploadError,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  switch (result.reason) {
    case "quota":
      return t("ecu.up.quota");
    case "verification":
      return t("ecu.up.verification");
    case "empty":
      return t("ecu.noFile");
    case "tooLarge":
      return t("ecu.up.tooLarge", { size: result.sizeMb ?? "?" });
    case "notImage":
      return t("ecu.up.notImage");
    case "storageFailed":
      return t("ecu.up.storageFailed");
    default:
      return result.error;
  }
}

export async function saveUpload(
  file: File,
  kind: UploadKind,
  profileId?: string,
): Promise<UploadResult | UploadError> {
  if (!file || file.size === 0) return { ok: false, reason: "empty", error: "No file received." };

  if (file.size > MAX_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      reason: "tooLarge",
      sizeMb,
      error: `File is ${sizeMb} MB. The limit is 2 MB.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detect(buffer);

  if (!detected) {
    // Deliberately does not echo the claimed type back — the point is that we
    // did not believe it.
    return {
      ok: false,
      reason: "notImage",
      error:
        "That file is not a PNG, JPEG, GIF, WebP or ICO. The contents are checked, not the file name — SVG is not accepted because it can carry scripts.",
    };
  }

  // The object path comes from us, never from the upload. A user-supplied name
  // can contain traversal segments, null bytes, or a second extension.
  const objectPath = `${kind}/${crypto.randomUUID()}.${detected.ext}`;

  const supabase = createAdminClient();
  const customerUpload = kind === "avatars" || kind === "reviews";
  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  if (customerUpload) {
    const sessionUser = await getSessionUser();
    const profile = await getCurrentProfile();
    if (!profileId || !sessionUser || profile?.id !== profileId || ((await emailVerificationRequired(profile.role)) && !hasVerifiedMailbox(sessionUser))) {
      return { ok: false, reason: "verification", error: "Verify your email at /security before uploading photos." };
    }
    // The database checks the profile/Auth association as well as the quota.
    const limited = await rateLimit({ key: "uploads:customer", identifier: profileId, limit: 10, windowMs: 60 * 60_000, failClosed: true });
    if (!limited.ok) return { ok: false, reason: "quota", error: "Your photo upload limit has been reached." };
    const { error: quotaError } = await supabase.rpc("reserve_customer_upload", {
      p_profile_id: profileId, p_auth_user_id: sessionUser!.id, p_object_path: objectPath,
      p_kind: kind, p_bytes: buffer.length, p_public_url: publicUrl,
    });
    if (quotaError) return { ok: false, reason: quotaError.message.includes("upload_quota") ? "quota" : "storageFailed", error: "Photo uploads are unavailable or your storage limit has been reached." };
  }

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
    if (customerUpload) await supabase.from("customer_uploads").delete().eq("object_path", objectPath).eq("profile_id", profileId!);
    console.error("[upload] storage rejected the object", error.message);
    return {
      ok: false,
      reason: "storageFailed",
      error:
        "Could not store the file. If this is a fresh deployment, check that migration 0016 has been run — it creates the storage bucket.",
    };
  }

  if (customerUpload) {
    const { error: recordError } = await supabase.from("customer_uploads").update({ ready: true }).eq("object_path", objectPath).eq("profile_id", profileId!);
    if (recordError) {
      const removed = await supabase.storage.from(BUCKET).remove([objectPath]);
      if (!removed.error) await supabase.from("customer_uploads").delete().eq("object_path", objectPath).eq("profile_id", profileId!);
      return { ok: false, reason: "storageFailed", error: "Photo ownership could not be saved." };
    }
  }

  return { ok: true, url: publicUrl, mime: detected.mime, bytes: buffer.length };
}

/* ── Audio: the notification sound ─────────────────────────────────────── */

/**
 * One megabyte. A notification chime is a second of audio; anything larger is
 * a music file, and this one downloads in every signed-in tab on the platform
 * and plays on every order.
 */
const MAX_AUDIO_BYTES = 1024 * 1024;

/**
 * Audio signatures, checked the same way as the image ones — by BYTES.
 *
 * MP3 is the awkward member: it has no single magic number. A file either
 * opens with an ID3 tag ("ID3") or straight into a frame header, whose first
 * eleven bits are all set — 0xFF followed by a byte whose top three bits are
 * set (0xE0 mask). Both forms are accepted below.
 */
const AUDIO_SIGNATURES: { ext: string; mime: string; bytes: number[]; offset?: number }[] = [
  // "RIFF....WAVE" — the tag sits at offset 8, after the size field.
  { ext: "wav", mime: "audio/wav", bytes: [0x57, 0x41, 0x56, 0x45], offset: 8 },
  { ext: "ogg", mime: "audio/ogg", bytes: [0x4f, 0x67, 0x67, 0x53] }, // "OggS"
  { ext: "m4a", mime: "audio/mp4", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp"
  { ext: "mp3", mime: "audio/mpeg", bytes: [0x49, 0x44, 0x33] }, // "ID3"
];

function detectAudio(buffer: Buffer): { ext: string; mime: string } | null {
  for (const signature of AUDIO_SIGNATURES) {
    const offset = signature.offset ?? 0;
    if (buffer.length < offset + signature.bytes.length) continue;
    if (signature.bytes.every((byte, i) => buffer[offset + i] === byte)) {
      return { ext: signature.ext, mime: signature.mime };
    }
  }

  // A bare MPEG frame header: 0xFF, then three set bits at the top of byte 2.
  if (buffer.length > 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0) {
    return { ext: "mp3", mime: "audio/mpeg" };
  }
  return null;
}

/**
 * Store an uploaded notification sound and return its public URL.
 *
 * Same rules as `saveUpload`: the bytes decide the type, the object path comes
 * from us and never from the file name, and the object is written server-side
 * with the service-role key. The bucket's own allow-list has to permit these
 * mime types too — that is migration 0028.
 */
export async function saveAudioUpload(file: File): Promise<UploadResult | UploadError> {
  if (!file || file.size === 0) return { ok: false, error: "No file received." };

  if (file.size > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      error: `The sound is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 1 MB — a notification chime should be a second or two.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectAudio(buffer);

  if (!detected) {
    return {
      ok: false,
      error:
        "That file is not a WAV, MP3, OGG or M4A. The contents are checked, not the file name.",
    };
  }

  const objectPath = `sounds/${crypto.randomUUID()}.${detected.ext}`;
  const supabase = createAdminClient();

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: detected.mime,
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) {
    console.error("[upload] storage rejected the sound", error.message);
    const mimeRejected = /mime|content type/i.test(error.message);
    return {
      ok: false,
      error: mimeRejected
        ? "The storage bucket does not accept audio yet — run migration 0028_notification_sound_uploads.sql in Supabase."
        : "Could not store the sound. If this is a fresh deployment, check that migration 0016 has been run — it creates the storage bucket.",
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
  const expectedOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  let parsed: URL;
  try { parsed = new URL(publicUrl); } catch { return; }
  if (parsed.origin !== expectedOrigin || parsed.search || parsed.hash) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return;

  const objectPath = publicUrl.slice(index + marker.length);
  if (!objectPath) return;

  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
  if (error) console.warn("[upload] could not remove", objectPath, error.message);
}

/** A customer can remove only an avatar recorded against their own profile. */
export async function deleteOwnedAvatar(publicUrl: string | null | undefined, profileId: string): Promise<void> {
  if (!publicUrl) return;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("customer_uploads").select("object_path")
    .eq("profile_id", profileId).eq("kind", "avatars").eq("public_url", publicUrl).maybeSingle();
  if (error || !data) return;
  const removed = await supabase.storage.from(BUCKET).remove([data.object_path]);
  if (!removed.error) await supabase.from("customer_uploads").delete().eq("profile_id", profileId).eq("object_path", data.object_path);
}
