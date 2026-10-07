"use server";

import { revalidatePath } from "next/cache";
import { getTranslator } from "@/lib/i18n/locale-server";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { requireRole, requireUser } from "@/lib/auth/session";
import { deleteOwnedAvatar, deleteUpload, localizeUploadError, saveAudioUpload, saveUpload, type UploadKind } from "@/lib/uploads";
import { firstIssueMessage } from "@/lib/i18n/issue-message";
import { isCustomSound } from "@/lib/notification-sound";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { verifyAccountPassword } from "@/lib/auth/verify-password";
import type { ActionResult } from "./admin-actions";

/* ── Uploads ───────────────────────────────────────────────────────────── */

export interface UploadActionResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** The settings keys that hold an uploaded branding image. */
export type BrandingAssetKey = "brand_logo_url" | "brand_favicon_url" | "brand_icon_url";

function isBrandingAssetKey(key: unknown): key is BrandingAssetKey {
  return key === "brand_logo_url" || key === "brand_favicon_url" || key === "brand_icon_url";
}

/** A one-word name for each key, for audit summaries. */
const BRANDING_ASSET_LABEL: Record<BrandingAssetKey, string> = {
  brand_logo_url: "logo",
  brand_favicon_url: "favicon",
  brand_icon_url: "app icon",
};

/**
 * Upload a branding asset (logo, favicon or PWA app icon) and write its URL
 * into settings.
 *
 * Admin only. The file is validated by its bytes in `saveUpload` — the browser
 * does not get a vote on what it is.
 */
export async function uploadBrandingAsset(
  settingKey: BrandingAssetKey,
  formData: FormData,
): Promise<UploadActionResult> {
  const admin = await requireRole("admin");
  // The type is not a check: a POST can name ANY settings key — the payment
  // gateway, the fees — and this would overwrite it, past every super-admin
  // rule updateSettings enforces. Only the three branding keys, at runtime.
  if (!isBrandingAssetKey(settingKey)) return { ok: false, error: "Unknown branding asset." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };

  const result = await saveUpload(file, "branding");
  if (!result.ok) return { ok: false, error: result.error };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("settings")
    .update({ value: result.url })
    .eq("key", settingKey);

  if (error) {
    console.error("[profile:uploadBrandingAsset]", settingKey, error.message);
    return { ok: false, error: "Uploaded, but could not save it to settings." };
  }

  await writeAudit(admin, {
    action: "settings.branding_upload",
    entityType: "settings",
    entityId: settingKey,
    summary: `Uploaded ${BRANDING_ASSET_LABEL[settingKey]}`,
    metadata: { url: result.url, bytes: result.bytes, mime: result.mime },
  });

  // Branding is read by every page, tab, email, the PWA manifest and the
  // share cards (§9), so the whole layout is revalidated rather than just
  // this route.
  revalidatePath("/", "layout");
  return { ok: true, url: result.url };
}

/**
 * Upload a custom notification sound and make it the platform's sound.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT WRITES THE SAME SETTING THE BUILT-IN PICKER WRITES.
 *
 *  `notification_sound` holds either a built-in name ("tri-tone") or a URL.
 *  Uploading stores the URL there, so every reader — the realtime provider,
 *  the preview button, anything added later — resolves it through the one
 *  helper in lib/notification-sound and neither knows nor cares which kind it
 *  got. Switching back to a built-in is just picking one from the list.
 *
 *  The PREVIOUS custom sound is deleted after the new value is saved, not
 *  before: if the settings write fails, the sound currently playing on the
 *  platform must still exist. Deletion is best-effort — an orphaned object
 *  costs a fraction of a cent, a broken sound costs every notification.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function uploadNotificationSound(formData: FormData): Promise<UploadActionResult> {
  const admin = await requireRole("admin");

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file received." };

  const result = await saveAudioUpload(file);
  if (!result.ok) return { ok: false, error: result.error };

  const supabase = createAdminClient();

  const { data: current } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "notification_sound")
    .maybeSingle();
  const previous = (current as { value: string | null } | null)?.value ?? null;

  const { error } = await supabase
    .from("settings")
    .update({ value: result.url })
    .eq("key", "notification_sound");

  if (error) {
    console.error("[profile:uploadNotificationSound]", error.message);
    await deleteUpload(result.url);
    return { ok: false, error: "Uploaded, but could not save it to settings." };
  }

  // Only now is the old one unreachable.
  if (previous && isCustomSound(previous)) await deleteUpload(previous);

  await writeAudit(admin, {
    action: "settings.sound_upload",
    entityType: "settings",
    entityId: "notification_sound",
    summary: `Uploaded a custom notification sound (${(result.bytes / 1024).toFixed(0)} KB)`,
    metadata: { url: result.url, bytes: result.bytes, mime: result.mime },
  });

  // The sound is read by every signed-in shell.
  revalidatePath("/", "layout");
  return { ok: true, url: result.url };
}

/** Clear a branding asset without uploading a replacement. */
export async function clearBrandingAsset(settingKey: BrandingAssetKey): Promise<ActionResult> {
  const admin = await requireRole("admin");
  if (!isBrandingAssetKey(settingKey)) return { ok: false, error: "Unknown branding asset." };

  const supabase = createAdminClient();
  const { error } = await supabase.from("settings").update({ value: "" }).eq("key", settingKey);

  if (error) return { ok: false, error: "Could not clear it." };

  await writeAudit(admin, {
    action: "settings.branding_clear",
    entityType: "settings",
    entityId: settingKey,
    summary: `Cleared ${BRANDING_ASSET_LABEL[settingKey]}`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── Restaurant profile: opening hours and images ──────────────────────── */

export interface OpeningHourInput {
  /** 0 = Sunday, matching the column's `check (weekday between 0 and 6)`. */
  weekday: number;
  /** "HH:MM". Both null means closed that day. */
  opensAt: string | null;
  closesAt: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Replace the whole week's opening hours.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A CLOSED DAY IS A ROW WITH TWO NULLS, NOT A MISSING ROW.
 *
 *  The migration's own comment says why: "we have no data" and "we are shut"
 *  are different answers, and the public page renders them differently — one
 *  says "Fermé le lundi", the other says nothing at all. So all seven days are
 *  written every time, and a day the manager turned off is stored explicitly.
 *
 *  Upserted on (restaurant_id, weekday) — the table's unique constraint — so
 *  saving twice updates rather than accumulating a second Monday. The conflict
 *  target includes restaurant_id, so this can only ever land on rows belonging
 *  to the branch in the session.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function saveOpeningHours(hours: OpeningHourInput[]): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("profile.edit");

  const seen = new Set<number>();

  for (const day of hours) {
    if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) {
      return { ok: false, error: t("est.notAWeekday") };
    }
    if (seen.has(day.weekday)) return { ok: false, error: t("est.dayTwice") };
    seen.add(day.weekday);

    const opens = day.opensAt?.trim() || null;
    const closes = day.closesAt?.trim() || null;

    // One time without the other is not a state the public page can render:
    // "open from 11:00 until we decide" is not opening hours.
    if ((opens === null) !== (closes === null)) {
      return { ok: false, error: t("est.setBothTimes") };
    }
    if (opens !== null && (!HHMM.test(opens) || !HHMM.test(closes!))) {
      return { ok: false, error: t("est.timeFormat") };
    }

    // A closing time BEFORE the opening time is deliberately allowed: a
    // grill open 18:00–02:00 crosses midnight, and rejecting it would refuse
    // the most common evening service in the city.
  }

  if (seen.size !== 7) return { ok: false, error: t("est.allSevenDays") };

  const supabase = createAdminClient();
  const { error } = await supabase.from("restaurant_hours").upsert(
    hours.map((day) => ({
      restaurant_id: active.restaurantId,
      weekday: day.weekday,
      opens_at: day.opensAt?.trim() || null,
      closes_at: day.closesAt?.trim() || null,
    })),
    { onConflict: "restaurant_id,weekday" },
  );

  if (error) {
    console.error("[profile:saveOpeningHours]", error.message);
    return { ok: false, error: t("est.hoursSaveFailed") };
  }

  revalidatePath("/m/profile");
  revalidatePath("/m", "layout");
  return { ok: true };
}

/**
 * Store a logo or cover image and hand back its URL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY DOES NOT WRITE TO `restaurants`.
 *
 *  It persists the bytes and returns a path; the caller passes that path into
 *  updateRestaurantProfile alongside every other edit, so one Save commits the
 *  whole form. Writing the column here instead would make picking a file take
 *  effect on its own — the exact behaviour that was fixed on the admin
 *  settings screen, where choosing a logo and pressing Discard still changed
 *  the logo.
 *
 *  The file is validated by its BYTES in saveUpload (§9). `file.type` and
 *  `file.name` both come from the browser and neither gets a vote.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function uploadRestaurantImage(formData: FormData): Promise<UploadActionResult> {
  const t = await getTranslator();
  await requireCapability("profile.edit");

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: t("ecu.noFile") };

  const result = await saveUpload(file, "restaurants" satisfies UploadKind);
  if (!result.ok) return { ok: false, error: localizeUploadError(result, t) };

  return { ok: true, url: result.url };
}

/* ── Own profile ───────────────────────────────────────────────────────── */

// The message is a dictionary key, translated by firstIssueMessage below.
const ProfileSchema = z.object({
  name: z.string().trim().min(2, "ecu.v.profileName").max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v === "" ? null : (v ?? null))),
});

/**
 * Update your own profile.
 *
 * `requireUser`, not `requireRole` — anyone signed in edits their own record,
 * and the id comes from the SESSION, never from the form. Accepting an id from
 * the client here would let any user rewrite any other user's profile.
 *
 * The email is deliberately not editable: changing it changes the login
 * identity and needs a verification round-trip through Supabase Auth.
 */
export async function updateOwnProfile(formData: FormData): Promise<ActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const parsed = ProfileSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error, t) };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ name: parsed.data.name, phone: parsed.data.phone })
    .eq("id", user.id);

  if (error) {
    console.error("[profile:updateOwnProfile]", error.message);
    return { ok: false, error: t("ecu.profileSaveFailed") };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Upload your own avatar. */
export async function uploadOwnAvatar(formData: FormData): Promise<UploadActionResult> {
  const t = await getTranslator();
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: t("ecu.noFile") };

  const result = await saveUpload(file, "avatars" satisfies UploadKind, user.id);
  if (!result.ok) return { ok: false, error: localizeUploadError(result, t) };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: result.url })
    .eq("id", user.id);

  if (error) {
    await deleteOwnedAvatar(result.url, user.id);
    return { ok: false, error: t("ecu.avatarNotSaved") };
  }
  await deleteOwnedAvatar(user.avatarUrl, user.id);

  revalidatePath("/", "layout");
  return { ok: true, url: result.url };
}

/**
 * Change your own password.
 *
 * Goes through the USER'S OWN Supabase session, not the admin client. That is
 * what makes Supabase re-issue tokens and invalidate the others — doing it
 * with the service key would change the stored hash while leaving every other
 * session alive, which is the opposite of what a password change is for.
 */
export async function changeOwnPassword(formData: FormData): Promise<ActionResult> {
  const t = await getTranslator();
  const profile = await requireUser();

  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current) return { ok: false, error: t("ecu.currentPasswordRequired") };
  if (password.length < 8) return { ok: false, error: t("ecu.passwordLength") };
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: t("ecu.passwordStrength") };
  }
  if (password !== confirm) return { ok: false, error: t("ecu.passwordMismatch") };

  /*
    THE CURRENT PASSWORD FIRST (security review 2026-10-05). A session alone
    used to be enough, so whoever picked up an unlocked phone could replace
    the password — and with it every check that asks for it (the withdrawal
    PIN is set with the account password). Counted per person, so it is not
    a guessing oracle either.
  */
  const limited = await rateLimit({ key: "profile:password-change", identifier: profile.id, limit: 5, windowMs: 60 * 60_000, failClosed: true });
  if (!limited.ok) return { ok: false, error: t("ecu.authTooManyAttemptsHour") };

  const check = await verifyAccountPassword(profile.authUserId, current);
  if (check === "wrong") return { ok: false, error: t("ecu.currentPasswordWrong") };
  if (check === "unavailable") return { ok: false, error: t("ecu.authPasswordChangeFailed") };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password, current_password: current });

  if (error) {
    console.error("[profile:changeOwnPassword]", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
