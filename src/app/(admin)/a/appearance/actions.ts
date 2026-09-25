"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/data/platform-actions";
import { saveUpload, deleteUpload } from "@/lib/uploads";
import { APPEARANCE_IMAGES, type AppearanceKey } from "@/lib/appearance";
import { COLOR_PALETTES } from "@/lib/branding";
import type { ActionResult } from "@/lib/data/admin-actions";

/**
 * Choosing the pictures on the landing page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE KEY IS VALIDATED AGAINST A LIST, NOT TRUSTED.
 *
 *  A Server Action is a public POST endpoint. Writing `settings` at whatever
 *  key the caller names would let anyone who can reach it overwrite
 *  `service_charge_percent`, `payments_enabled` or `brand_name` — the
 *  capability check proves they are an administrator, it does not prove they
 *  meant to touch THIS row. Only the seven keys below are writable here.
 * ─────────────────────────────────────────────────────────────────────────
 */

const ALLOWED = new Set<string>(APPEARANCE_IMAGES.map((image) => image.key));

function isAppearanceKey(value: unknown): value is AppearanceKey {
  return typeof value === "string" && ALLOWED.has(value);
}

/** Whatever is stored now, so a replacement can retire the file it replaces. */
async function currentValue(key: AppearanceKey): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined)?.trim() || null;
}

export async function uploadAppearanceImage(
  key: string,
  formData: FormData,
): Promise<ActionResult & { url?: string }> {
  const admin = await requireRole("admin");
  if (!isAppearanceKey(key)) return { ok: false, error: "Unknown image slot." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };

  const previous = await currentValue(key);

  const result = await saveUpload(file, "appearance");
  if (!result.ok) return { ok: false, error: result.error };

  const supabase = createAdminClient();
  const { error } = await supabase.from("settings").update({ value: result.url }).eq("key", key);

  if (error) {
    console.error("[appearance:upload]", key, error.message);
    // The row still points at the old image, so the new object is unreachable
    // — remove it rather than leaving a paid-for orphan behind.
    await deleteUpload(result.url);
    return {
      ok: false,
      error:
        "Uploaded, but could not save it. If this is a fresh deployment, check that migration 0016 has been run.",
    };
  }

  // Only once the row is safely pointing elsewhere.
  await deleteUpload(previous);

  await writeAudit(admin, {
    action: "appearance.image_set",
    entityType: "settings",
    entityId: key,
    summary: `Changed the ${key.replace(/_/g, " ")}`,
    metadata: { url: result.url, bytes: result.bytes, mime: result.mime },
  });

  // The homepage is statically shaped but reads these on every request; the
  // layout is revalidated because the hero is above the fold on the one page
  // most visitors ever see.
  revalidatePath("/", "layout");
  return { ok: true, url: result.url };
}

/** Put a slot back to the photograph the platform ships with. */
export async function resetAppearanceImage(key: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  if (!isAppearanceKey(key)) return { ok: false, error: "Unknown image slot." };

  const previous = await currentValue(key);

  const supabase = createAdminClient();
  const { error } = await supabase.from("settings").update({ value: "" }).eq("key", key);
  if (error) {
    console.error("[appearance:reset]", key, error.message);
    return { ok: false, error: "Could not reset the image." };
  }

  await deleteUpload(previous);

  await writeAudit(admin, {
    action: "appearance.image_reset",
    entityType: "settings",
    entityId: key,
    summary: `Reset the ${key.replace(/_/g, " ")} to the default`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── Colour palette ─────────────────────────────────────────────────────── */

/**
 * Switch the whole site between the classic sage palette and "Ndolé", the
 * appetite palette (globals.css). Validated against the list like the image
 * keys above; any admin may change it (it is branding, not money), and it is
 * audited. Upserted so it works before a migration seeds the row.
 */
export async function setColorPalette(palette: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  if (!(COLOR_PALETTES as readonly string[]).includes(palette)) {
    return { ok: false, error: "Unknown palette." };
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from("settings").upsert(
    {
      key: "color_palette",
      value: palette,
      value_type: "string",
      category: "appearance",
      label: "Colour palette",
      description: "classic = original sage; ndole = appetite palette (chilli orange actions, deep green brand).",
    },
    { onConflict: "key" },
  );
  if (error) {
    console.error("[appearance:palette]", error.message);
    return { ok: false, error: "Could not save the palette." };
  }
  await writeAudit(admin, {
    action: "appearance.palette",
    entityType: "settings",
    summary: `Colour palette set to ${palette}`,
  });
  // Every page renders the palette attribute from the root layout.
  revalidatePath("/", "layout");
  return { ok: true };
}
