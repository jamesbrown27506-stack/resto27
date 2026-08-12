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

  if (input.subject.trim().length < 4) return { ok: false, error: "Subject is too short." };
  if (input.body.trim().length < 10) return { ok: false, error: "Message is too short." };

  const supabase = createAdminClient();

  // Resolve the audience to actual profile ids, so the recorded recipient
  // count is what was really delivered rather than an estimate shown earlier.
  let recipientQuery = supabase.from("profiles").select("id").eq("status", "active");
  if (input.audience === "managers") recipientQuery = recipientQuery.eq("role", "manager");
  else if (input.audience === "customers") recipientQuery = recipientQuery.eq("role", "customer");
  else if (input.audience === "admins") recipientQuery = recipientQuery.eq("role", "admin");

  const { data: recipients, error: readError } = await recipientQuery;

  if (readError) {
    console.error("[platform:sendBroadcast]", readError.message);
    return { ok: false, error: "Could not resolve the audience." };
  }

  const ids = (recipients ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return { ok: false, error: "That audience has no active members." };

  const { error: notifyError } = await supabase.from("notifications").insert(
    ids.map((profileId) => ({
      profile_id: profileId,
      title: input.subject.trim(),
      body: input.body.trim(),
      tone: "info" as const,
    })),
  );

  if (notifyError) {
    console.error("[platform:sendBroadcast] notifications", notifyError.message);
    return { ok: false, error: "Could not deliver the in-app notifications." };
  }

  await supabase.from("broadcasts").insert({
    subject: input.subject.trim(),
    body: input.body.trim(),
    audience: input.audience,
    channels: input.sendEmail ? "in_app,email" : "in_app",
    recipient_count: ids.length,
    sent_by_email: admin.email,
  });

  await writeAudit(admin, {
    action: "broadcast.send",
    entityType: "broadcast",
    summary: `Sent "${input.subject.trim()}" to ${ids.length} ${input.audience}`,
  });

  // Email delivery is not wired: no provider is configured yet, and the switch
  // in the composer says so rather than silently doing nothing.
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

export async function replyToSupport(messageId: string, reply: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

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

/* ── Settings ──────────────────────────────────────────────────────────── */

export async function updateSettings(changes: Record<string, string>): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const supabase = createAdminClient();

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
