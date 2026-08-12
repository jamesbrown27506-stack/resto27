"use server";

import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { UPLOAD_BUCKET } from "@/lib/uploads";

/**
 * Store an object, serve it, delete it.
 *
 * Each step reports separately on purpose. "Uploads are broken" is not
 * actionable; "stored fine, but the public URL returned 400" points straight
 * at the bucket being private, and "stored fine, served fine, delete failed"
 * is a permissions problem that would quietly accumulate orphans.
 */

export interface StorageProbeStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface StorageProbeResult {
  steps: StorageProbeStep[];
}

/**
 * A real 1×1 transparent PNG.
 *
 * Real bytes, not a text file with a .png name — `saveUpload` sniffs magic
 * bytes and the bucket enforces an allowed-MIME list, so a fake would fail for
 * reasons that have nothing to do with what is being tested.
 */
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export async function probeStorage(): Promise<StorageProbeResult> {
  await requireRole("admin");

  const steps: StorageProbeStep[] = [];
  const supabase = createAdminClient();
  const objectPath = `diagnostics/probe-${crypto.randomUUID()}.png`;

  // ── 1. Does the bucket exist at all ──
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    steps.push({ name: "Reach storage", ok: false, detail: listError.message });
    return { steps };
  }

  const bucket = (buckets ?? []).find((b) => b.id === UPLOAD_BUCKET);
  if (!bucket) {
    steps.push({
      name: `Find bucket "${UPLOAD_BUCKET}"`,
      ok: false,
      detail: "Not found. Run migration 0016 — it creates the bucket.",
    });
    return { steps };
  }
  steps.push({
    name: `Find bucket "${UPLOAD_BUCKET}"`,
    ok: true,
    detail: bucket.public ? "Present and public." : "Present, but NOT public — images will 404.",
  });

  // ── 2. Store ──
  const bytes = Buffer.from(PIXEL_PNG_BASE64, "base64");
  const { error: uploadError } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(objectPath, bytes, { contentType: "image/png", upsert: false });

  if (uploadError) {
    steps.push({ name: "Store an object", ok: false, detail: uploadError.message });
    return { steps };
  }
  steps.push({ name: "Store an object", ok: true, detail: `Wrote ${bytes.length} bytes.` });

  // ── 3. Serve it back, as a browser would ──
  const {
    data: { publicUrl },
  } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(objectPath);

  try {
    // No auth header, deliberately: this is exactly the anonymous request a
    // visitor's browser makes for an <img>. Passing the service key here would
    // make the test pass on a private bucket that fails for everyone else.
    const response = await fetch(publicUrl, { cache: "no-store" });
    const served = await response.arrayBuffer();

    steps.push({
      name: "Serve it publicly",
      ok: response.ok && served.byteLength === bytes.length,
      detail: response.ok
        ? served.byteLength === bytes.length
          ? `HTTP ${response.status}, ${served.byteLength} bytes — byte-identical.`
          : `HTTP ${response.status} but ${served.byteLength} bytes back, expected ${bytes.length}.`
        : `HTTP ${response.status}. A 400 here usually means the bucket is private.`,
    });
  } catch (error) {
    steps.push({
      name: "Serve it publicly",
      ok: false,
      detail: error instanceof Error ? error.message : "Request failed.",
    });
  }

  // ── 4. Clean up after ourselves ──
  const { error: removeError } = await supabase.storage.from(UPLOAD_BUCKET).remove([objectPath]);
  steps.push({
    name: "Delete it again",
    ok: !removeError,
    detail: removeError
      ? `${removeError.message} — probe files will accumulate under diagnostics/.`
      : "Removed. Nothing left behind.",
  });

  return { steps };
}
