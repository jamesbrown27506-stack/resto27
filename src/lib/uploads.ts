import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local file uploads.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  VALIDATED BY CONTENT, NEVER BY EXTENSION OR MIME TYPE (§9).
 *
 *  `file.type` comes from the browser and `file.name` comes from the user.
 *  Both are attacker-controlled. Trusting either is how a .php renamed to
 *  .jpg — or a .jpg whose bytes are a script — ends up executable on your
 *  server.
 *
 *  So every upload is sniffed: the first bytes must match a known image
 *  signature, and the extension we write is derived from THOSE BYTES, not
 *  from whatever the file was called.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  Files land in public/uploads/, served directly by Next as static assets.
 *
 *  NOTE FOR DEPLOYMENT: this writes to the local filesystem, which works on a
 *  VPS or under XAMPP but NOT on Vercel, where the filesystem is read-only and
 *  ephemeral. Moving to object storage means changing `persist()` below and
 *  nothing else.
 */

export type UploadKind = "branding" | "avatars" | "restaurants" | "menu";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Magic-byte signatures.
 *
 * SVG is deliberately absent. It is XML, it can carry <script>, and it is
 * served from our own origin — which makes an uploaded SVG a stored XSS with
 * extra steps. PNG covers every favicon case that matters.
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
  /** Public URL path, e.g. /uploads/branding/ab12….png */
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

  // Filename comes from us, never from the upload. A user-supplied name can
  // contain path traversal, null bytes, or a second extension.
  const filename = `${crypto.randomUUID()}.${detected.ext}`;
  const directory = path.join(process.cwd(), "public", "uploads", kind);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), buffer);
  } catch (error) {
    console.error("[upload] write failed", error);
    return { ok: false, error: "Could not save the file to disk." };
  }

  return {
    ok: true,
    url: `/uploads/${kind}/${filename}`,
    mime: detected.mime,
    bytes: buffer.length,
  };
}
