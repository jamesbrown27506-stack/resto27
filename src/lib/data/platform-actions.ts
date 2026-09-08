"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import {
  clearImpersonationCookie,
  getImpersonation,
  setImpersonationCookie,
} from "@/lib/auth/impersonation";
import { trySendMail } from "@/lib/mail";
import { notify } from "@/lib/notify";
import { rateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "./admin-actions";

/**
 * Platform-operations mutations.
 *
 * Every one re-checks the admin role: a Server Action is a POST endpoint with
 * a generated URL and never passes through the layout that guards its page.
 */

/* ── The audit writer (§9) ─────────────────────────────────────────────── */

interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
  impersonatorEmail?: string | null;
}

/**
 * Write one audit row.
 *
 * TWO RULES, BOTH FROM §9:
 *
 *  1. The actor's email and role are SNAPSHOTTED onto the row, never joined.
 *     Actors get anonymised; the trail has to survive them. A join to profiles
 *     would render "Compte supprimé" against every historical action.
 *
 *  2. THIS NEVER THROWS. A failure to write history must not break the
 *     operation being recorded. Suspending a fraudulent account must succeed
 *     even if the audit table is full, locked or missing.
 */
export async function writeAudit(
  actor: { id: string; email: string; role: string },
  input: AuditInput,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const headerList = await headers();

    await supabase.from("audit_log").insert({
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      actor_profile_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      impersonator_email: input.impersonatorEmail ?? null,
      summary: input.summary ?? "",
      metadata: input.metadata ?? null,
      ip_address:
        headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headerList.get("x-real-ip") ??
        null,
      user_agent: headerList.get("user-agent"),
    });
  } catch (error) {
    console.error("[audit] write failed — operation continues regardless", error);
  }
}

/* ── Notifications ─────────────────────────────────────────────────────── */

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", admin.id);

  if (error) return { ok: false, error: "Could not mark it read." };

  revalidatePath("/a/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", admin.id)
    .is("read_at", null);

  if (error) return { ok: false, error: "Could not mark them read." };

  revalidatePath("/a/notifications");
  return { ok: true };
}

/* ── Broadcasts ────────────────────────────────────────────────────────── */

export async function sendBroadcast(input: {
  subject: string;
  body: string;
  audience: string;
  sendEmail: boolean;
}): Promise<ActionResult> {
  const admin = await requireRole("admin");

  // A broadcast with email is thousands of SMTP sends in one click — the most
  // expensive single action in the app. A compromised or angry admin account
  // must not be able to burn the mail budget repeatedly.
  const limited = await rateLimit({ key: "broadcast:send", limit: 5, windowMs: 60 * 60_000, identifier: admin.id });
  if (!limited.ok) return { ok: false, error: "Broadcast rate limit reached. Try again in an hour." };

  if (input.subject.trim().length < 4) return { ok: false, error: "Subject is too short." };
  if (input.body.trim().length < 10) return { ok: false, error: "Message is too short." };

  const supabase = createAdminClient();

  // The audience becomes a role list — the notify writer resolves it to active
  // profiles itself, so the recorded count is what was really delivered.
  const roles: ("manager" | "customer" | "admin")[] =
    input.audience === "managers"
      ? ["manager"]
      : input.audience === "customers"
        ? ["customer"]
        : input.audience === "admins"
          ? ["admin"]
          : ["manager", "customer", "admin"];

  const result = await notify({
    event: "broadcast",
    roles,
    params: { subject: input.subject.trim(), bodyText: input.body.trim() },
    // In-app always (that is what the composer promises); email exactly when
    // the admin asked for it; push follows each user's own preference.
    channels: { inApp: true, email: input.sendEmail },
  });

  if (result.delivered === 0) {
    return { ok: false, error: "That audience has no active members." };
  }

  await supabase.from("broadcasts").insert({
    subject: input.subject.trim(),
    body: input.body.trim(),
    audience: input.audience,
    channels: input.sendEmail ? "in_app,email" : "in_app",
    recipient_count: result.delivered,
    sent_by_email: admin.email,
  });

  await writeAudit(admin, {
    action: "broadcast.send",
    entityType: "broadcast",
    summary: `Sent "${input.subject.trim()}" to ${result.delivered} ${input.audience}`,
  });

  revalidatePath("/a/broadcast");
  revalidatePath("/a/notifications");
  return { ok: true };
}

/* ── Review moderation ─────────────────────────────────────────────────── */

export async function dismissReviewReport(reviewId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("reviews")
    .update({ is_reported: false, report_reason: null })
    .eq("id", reviewId);

  if (error) return { ok: false, error: "Could not dismiss the report." };

  await writeAudit(admin, {
    action: "review.report_dismissed",
    entityType: "review",
    entityId: reviewId,
    summary: "Report dismissed; review stays published",
  });

  revalidatePath("/a/reviews");
  return { ok: true };
}

/**
 * Remove a review.
 *
 * A soft removal — the row stays, `removed_at` is stamped. §14.5 allows two
 * outcomes only: dismiss the report, or remove. There is deliberately no edit,
 * because rewriting someone's words and leaving their name on them is worse
 * than either.
 */
export async function removeReview(reviewId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { data: review } = await supabase
    .from("reviews")
    .select("restaurant_id, rating")
    .eq("id", reviewId)
    .maybeSingle();

  const { error } = await supabase
    .from("reviews")
    .update({ removed_at: new Date().toISOString(), removed_by: admin.email, is_reported: false })
    .eq("id", reviewId);

  if (error) return { ok: false, error: "Could not remove the review." };

  // The restaurant's denormalised rating has to be recomputed, or it keeps
  // counting a review that is no longer visible.
  if (review?.restaurant_id) {
    const { data: remaining } = await supabase
      .from("reviews")
      .select("rating")
      .eq("restaurant_id", review.restaurant_id)
      .is("removed_at", null);

    const ratings = (remaining ?? []).map((r) => (r as { rating: number }).rating);
    const average =
      ratings.length > 0
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
        : 0;

    await supabase
      .from("restaurants")
      .update({ rating: average, review_count: ratings.length })
      .eq("id", review.restaurant_id);
  }

  await writeAudit(admin, {
    action: "review.removed",
    entityType: "review",
    entityId: reviewId,
    summary: "Review removed from the public page",
  });

  revalidatePath("/a/reviews");
  return { ok: true };
}

/* ── Support ───────────────────────────────────────────────────────────── */

/**
 * The public contact form (P14 finally wired).
 *
 * NOT an admin action — anyone may write to support. Guards, therefore, are
 * the honeypot (a hidden field humans never fill), a per-IP rate limit that
 * protects the SMTP budget, and a max length on every field. The address and
 * subject are never echoed back into HTML unescaped — React escapes on
 * render, and the support list renders with plain text, so stored XSS has no
 * sink here.
 */
export async function submitSupportMessage(input: {
  name: string;
  email: string;
  subject: string;
  body: string;
  /** The honeypot — any value means a bot. */
  website?: string;
}): Promise<ActionResult> {
  // Bots fill the hidden field; pretending to succeed costs them nothing and
  // tells them nothing.
  if (input.website?.trim()) return { ok: true };

  const limited = await rateLimit({ key: "support:submit", limit: 3, windowMs: 60 * 60_000 });
  if (!limited.ok) {
    return { ok: false, error: "Too many messages from this address. Try again in an hour." };
  }

  const name = String(input.name ?? "").trim().slice(0, 120);
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 254);
  const subject = String(input.subject ?? "").trim().slice(0, 160);
  const body = String(input.body ?? "").trim().slice(0, 4000);

  if (name.length < 2) return { ok: false, error: "Name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Email is invalid." };
  if (subject.length < 4) return { ok: false, error: "Subject is too short." };
  if (body.length < 10) return { ok: false, error: "Message is too short." };

  const supabase = createAdminClient();
  const headerList = await headers();

  const { error } = await supabase.from("support_messages").insert({
    name,
    email,
    subject,
    body,
    status: "open",
    ip_address: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });

  if (error) {
    console.error("[support:submit]", error.message);
    return { ok: false, error: "Could not send the message. Please try again." };
  }

  // The admin bell is the inbox; email follows each admin's own preferences.
  await notify({
    event: "support",
    tone: "info",
    admins: true,
    href: "/a/support",
    params: { customerName: name, subject },
  });

  return { ok: true };
}

export async function replyToSupport(messageId: string, reply: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

  // Each reply is also an outbound SMTP send; throttle the endpoint.
  const limited = await rateLimit({ key: "support:reply", limit: 30, windowMs: 60 * 60_000, identifier: admin.id });
  if (!limited.ok) return { ok: false, error: "Reply rate limit reached. Try again later." };

  if (reply.trim().length < 10) return { ok: false, error: "Reply is too short." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("support_messages")
    .update({
      reply_body: reply.trim(),
      replied_by: admin.email,
      replied_at: new Date().toISOString(),
      status: "replied",
    })
    .eq("id", messageId);

  if (error) return { ok: false, error: "Could not save the reply." };

  await writeAudit(admin, {
    action: "support.replied",
    entityType: "support_message",
    entityId: messageId,
  });

  // The reply is stored either way, so nothing is lost if the send fails —
  // but the caller is told, rather than shown a success for an email that
  // never left.
  let note: string | undefined;
  const { data: message } = await supabase
    .from("support_messages")
    .select("name, email, subject")
    .eq("id", messageId)
    .maybeSingle();

  if (message?.email) {
    const result = await trySendMail({
      to: message.email,
      replyTo: admin.email,
      subject: `Re: ${message.subject}`,
      body: [`Hello ${message.name.split(" ")[0]},`, "", reply.trim(), "", "— RestoLink support"].join(
        "\n",
      ),
    });

    if (!result.sent) {
      note = `Reply saved, but not emailed (${result.reason}). Contact ${message.email} directly.`;
    }
  }

  revalidatePath("/a/support");
  return { ok: true, note };
}

export async function resolveSupport(messageId: string): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("support_messages")
    .update({ status: "resolved" })
    .eq("id", messageId);

  if (error) return { ok: false, error: "Could not resolve the message." };

  revalidatePath("/a/support");
  return { ok: true };
}

/* ── Platform coupons (migration 0023) ────────────────────────────────── */

/**
 * Create or update a platform coupon code.
 *
 * The whole programme is gated by the `platform_coupons_enabled` setting —
 * an admin can kill it with one switch in /a/settings — but each coupon also
 * carries its own `is_active`, so a single code can be retired without
 * touching the rest.
 */
export async function savePlatformCoupon(input: {
  id?: string;
  code: string;
  label?: string;
  discountType: string;
  discountValue: number;
  minOrder?: number;
  maxDiscount?: number | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  isActive: boolean;
}): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_]{3,30}$/.test(code)) {
    return { ok: false, error: "Code must be 3–30 characters: letters, digits, underscore." };
  }
  if (input.discountType !== "percent" && input.discountType !== "fixed") {
    return { ok: false, error: "Discount type must be percent or fixed." };
  }
  const value = Math.round(input.discountValue);
  if (!Number.isInteger(value) || value <= 0) return { ok: false, error: "A positive discount value is required." };
  if (input.discountType === "percent" && value > 100) return { ok: false, error: "Percent cannot exceed 100." };

  const supabase = createAdminClient();
  const patch: Record<string, unknown> = {
    code,
    label: input.label?.trim() ?? "",
    discount_type: input.discountType,
    discount_value: value,
    min_order: Math.round(input.minOrder ?? 0),
    max_discount:
      input.maxDiscount === null || input.maxDiscount === undefined ? null : Math.round(input.maxDiscount),
    ends_at: input.endsAt || null,
    usage_limit: input.usageLimit ?? null,
    is_active: input.isActive,
  };

  const { error } = input.id
    ? await supabase.from("platform_coupons").update(patch).eq("id", input.id)
    : await supabase.from("platform_coupons").insert(patch);

  if (error) {
    if (error.code === "23505") return { ok: false, error: "That code already exists." };
    console.error("[platform:savePlatformCoupon]", error.message);
    return { ok: false, error: "Could not save the coupon." };
  }

  await writeAudit(admin, {
    action: input.id ? "coupon.update" : "coupon.create",
    entityType: "platform_coupon",
    entityId: input.id,
    summary: `${input.id ? "Updated" : "Created"} coupon ${code}`,
  });

  revalidatePath("/a/coupons");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Flip one coupon's active flag. */
export async function togglePlatformCoupon(id: string, active: boolean): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("platform_coupons")
    .update({ is_active: active })
    .eq("id", id);

  if (error) return { ok: false, error: "Could not update the coupon." };

  await writeAudit(admin, {
    action: active ? "coupon.enable" : "coupon.disable",
    entityType: "platform_coupon",
    entityId: id,
  });

  revalidatePath("/a/coupons");
  return { ok: true };
}

/* ── Settings ──────────────────────────────────────────────────────────── */

export async function updateSettings(changes: Record<string, string>): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  if ("push_provider" in changes) return { ok: false, error: "Use the Notification delivery panel to change providers." };
  const entries = Object.entries(changes);
  if (entries.length === 0) return { ok: true };

  for (const [key, value] of entries) {
    const { error } = await supabase.from("settings").update({ value }).eq("key", key);
    if (error) {
      console.error("[platform:updateSettings]", key, error.message);
      return { ok: false, error: `Could not save "${key}".` };
    }
  }

  await writeAudit(admin, {
    action: "settings.update",
    entityType: "settings",
    summary: `Changed: ${entries.map(([k]) => k).join(", ")}`,
    metadata: changes,
  });

  // Branding, the service charge and grace days are read across the whole app,
  // so everything is revalidated rather than just this page.
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── Impersonation ─────────────────────────────────────────────────────── */

/**
 * Record the start of an impersonation session.
 *
 * §8: start and stop are BOTH audited, and the log records the impersonator
 * separately from the actor — otherwise the trail shows the tenant doing
 * things they never did.
 */
export async function beginImpersonation(restaurantId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name, branch_label")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restaurant) return { ok: false, error: "Restaurant not found." };

  await setImpersonationCookie(restaurantId);

  await writeAudit(admin, {
    action: "impersonation.start",
    entityType: "restaurant",
    entityId: restaurantId,
    summary: `Started impersonating ${restaurant.name}`,
    impersonatorEmail: admin.email,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * End the session.
 *
 * The stop is audited as deliberately as the start (§8): without it the log
 * shows when someone began acting as a tenant but never when they stopped, so
 * every later action by that admin is ambiguous.
 */
export async function endImpersonation(): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const active = await getImpersonation();

  await clearImpersonationCookie();

  if (active) {
    await writeAudit(admin, {
      action: "impersonation.stop",
      entityType: "restaurant",
      entityId: active.restaurantId,
      summary: `Stopped impersonating ${active.restaurantName}`,
      impersonatorEmail: admin.email,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
