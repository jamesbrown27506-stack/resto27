"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { superAdminOrError, type AuthProfile } from "@/lib/auth/session";
import {
  canChangeAdmin,
  countActiveSuperAdmins,
  effectiveSuperAdmin,
  isPlausibleEmail,
  normaliseEmail,
  superAdminColumnMissing,
  type AdminChange,
  type AdminLevel,
  type AdminSubject,
} from "@/lib/auth/super-admin-rules";
import { trySendMail } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { getBranding } from "@/lib/branding";
import { loadAdminSubjects, loadSubject } from "./admins";
import { writeAudit } from "./platform-actions";
import type { ActionResult } from "./admin-actions";

/**
 * Administrator management (/a/admins) — super admins only.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHO MAY CHANGE WHO IS AN ADMINISTRATOR.
 *
 *  Every action here opens with superAdminOrError(): a Server Action is a
 *  POST endpoint and never passes through the page that hides its buttons.
 *  The decision itself is canChangeAdmin() in lib/auth/super-admin-rules.ts
 *  (unit-tested): no self-demotion, no self-removal, never below one active
 *  super admin, no platform powers on a restaurant login.
 *
 *  The last-super-admin rule is checked BEFORE the write and again AFTER it.
 *  Two super admins demoting each other in the same second would each see
 *  "one other super remains" and both succeed; the re-count after the write
 *  catches that and puts the row back. Every change is audited with the
 *  acting admin snapshotted on the row.
 * ─────────────────────────────────────────────────────────────────────────
 */

const MIGRATION_MISSING =
  "Run migration 0063 (super administrators) in the Supabase SQL editor first — until then every administrator is a super administrator.";

function subjectOf(profile: AuthProfile): AdminSubject {
  return {
    id: profile.id,
    role: profile.role,
    isSuperAdmin: profile.isSuperAdmin,
    status: profile.status,
    deletedAt: profile.deletedAt,
  };
}

/** Escape LIKE wildcards so an email is matched literally (case-insensitively). */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * After a demotion or removal: is there still an active super admin? If not
 * (a race with another super admin), undo `revert` and report it.
 */
async function confirmSuperAdminRemains(revert: () => PromiseLike<unknown>): Promise<ActionResult | null> {
  const after = await loadAdminSubjects();
  if (after && countActiveSuperAdmins(after) >= 1) return null;
  await revert();
  return {
    ok: false,
    error: after
      ? "The platform must keep at least one active super administrator. The change was undone."
      : "Could not confirm a super administrator remains. The change was undone.",
  };
}

/* ── Add ───────────────────────────────────────────────────────────────── */

/**
 * Make someone an administrator, by email.
 *
 * AN EXISTING ACCOUNT is promoted in place (a customer only — a restaurant
 * login is refused: one account carrying both a tenant's keys and the
 * platform's is how one tenant ends up reading every other tenant's data).
 *
 * A NEW ADDRESS gets an account through the Supabase Auth admin API. We use
 * `generateLink({ type: "invite" })` and send the email OURSELVES rather than
 * `inviteUserByEmail`, for the same reason the reset email moved to
 * /auth/confirm (see that route): Supabase's invite redirect carries the
 * session in a URL fragment our /auth/callback never sees, and the built-in
 * mailer is rate-limited. The link we send is
 *   /auth/confirm?token_hash=…&type=invite&next=/reset-password
 * which verifies server-side in any browser and lands on "choose a password";
 * after that they sign in and arrive at /a.
 *
 * The handle_new_user() trigger floors every new account to 'customer'
 * (0001 — an 'admin' in client metadata is an escalation attempt), so the
 * role is set here, by the new auth user's id, once the trigger's row exists.
 */
export async function addAdministrator(input: {
  email: string;
  level: AdminLevel;
  name?: string;
}): Promise<ActionResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  // Each add can send an email and create an auth user.
  const limited = await rateLimit({ key: "admins:add", limit: 10, windowMs: 60 * 60_000, identifier: admin.id });
  if (!limited.ok) return { ok: false, error: "Too many administrators added in the last hour. Try again later." };

  const email = normaliseEmail(input.email);
  const level: AdminLevel = input.level === "super" ? "super" : "simple";
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!isPlausibleEmail(email)) return { ok: false, error: "Enter a valid email address." };

  const supabase = createAdminClient();
  const admins = await loadAdminSubjects();
  if (!admins) return { ok: false, error: "Could not read the administrators. Nothing was changed." };

  // Probe the column once: a SIMPLE admin cannot be represented before 0063.
  const probe = await supabase.from("profiles").select("is_super_admin").limit(1);
  const hasColumn = !superAdminColumnMissing(probe.error);
  if (!hasColumn && level === "simple") return { ok: false, error: MIGRATION_MISSING };

  const change: AdminChange = { kind: "grant", level };

  /* ── An existing account ───────────────────────────────────────────── */

  const { data: matches, error: lookupError } = await supabase
    .from("profiles")
    .select("id, name, email, role, status, deleted_at")
    .ilike("email", likeLiteral(email))
    .is("deleted_at", null)
    .limit(2);

  if (lookupError) {
    console.error("[admins:add] lookup", lookupError.message);
    return { ok: false, error: "Could not look up that email. Nothing was changed." };
  }

  if ((matches ?? []).length > 1) {
    return { ok: false, error: "More than one account uses that email. Resolve the duplicate first." };
  }

  const existing = matches?.[0] as
    | { id: string; name: string; email: string; role: string; status: string; deleted_at: string | null }
    | undefined;

  if (existing) {
    // A customer who is ALSO active staff somewhere is a restaurant login in
    // all but name (syncStaffRole would promote them on their next request).
    const { data: staff } = await supabase
      .from("restaurant_staff")
      .select("id")
      .eq("profile_id", existing.id)
      .eq("status", "active")
      .limit(1);

    const target: AdminSubject = {
      id: existing.id,
      role: staff && staff.length > 0 ? "manager" : existing.role,
      isSuperAdmin: false,
      status: existing.status,
      deletedAt: existing.deleted_at,
    };

    const verdict = canChangeAdmin({ actor: subjectOf(admin), target, change, admins });
    if (!verdict.ok) return verdict;
    if (existing.status === "suspended") {
      return { ok: false, error: "That account is suspended. Reinstate it on /a/users first." };
    }

    const patch: Record<string, unknown> = { role: "admin" };
    if (hasColumn) patch.is_super_admin = level === "super";

    const { data: updated, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", existing.id)
      // Conditional: if the row changed since we read it (made a manager,
      // anonymised), nothing is written and we say so.
      .eq("role", existing.role)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (error || !updated) {
      if (error) console.error("[admins:add] promote", error.message);
      return { ok: false, error: "The account changed meanwhile. Reload and try again." };
    }

    await writeAudit(admin, {
      action: "admin.grant",
      entityType: "profile",
      entityId: existing.id,
      summary: `Made ${existing.email} a ${level} administrator`,
      metadata: { email: existing.email, level, previousRole: existing.role, invited: false },
    });

    const loginUrl = `${await siteUrl()}/login`;
    const brand = await getBranding();
    const mail = await trySendMail({
      to: existing.email,
      subject: `You are now an administrator on ${brand.name}`,
      body: [
        `Hello ${existing.name.split(" ")[0] || "there"},`,
        "",
        `${admin.name} made you a${level === "super" ? " super" : "n"} administrator on ${brand.name}.`,
        "Sign in with your usual email and password; the administration area is at /a.",
        "",
        `— The ${brand.name} team`,
      ].join("\n"),
      action: { label: "Sign in", url: loginUrl },
      locale: "en",
    });

    revalidatePath("/a/admins");
    revalidatePath("/a/users");
    return {
      ok: true,
      note: mail.sent
        ? `${existing.email} is now a ${level} administrator.`
        : `${existing.email} is now a ${level} administrator, but the email was not sent (${mail.reason}). Let them know directly.`,
    };
  }

  /* ── A new account: invite ─────────────────────────────────────────── */

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: name ? { name } : undefined,
      redirectTo: `${await siteUrl()}/auth/callback?next=/a`,
    },
  });

  if (linkError || !link?.user || !link.properties?.hashed_token) {
    console.error("[admins:add] invite", linkError?.message);
    return {
      ok: false,
      error: /already|registered|exists/i.test(linkError?.message ?? "")
        ? "An account with that email already exists but has no usable profile. Check /a/users."
        : "Could not create the invitation. Nothing was changed.",
    };
  }

  const authUserId = link.user.id;

  // handle_new_user() inserts the profile in the same transaction as the
  // auth user, so it is normally there already — the short retry only
  // covers a slow replica, not a missing trigger.
  let profileId: string | null = null;
  for (let attempt = 0; attempt < 4 && !profileId; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    const { data } = await supabase.from("profiles").select("id").eq("auth_user_id", authUserId).maybeSingle();
    profileId = (data as { id: string } | null)?.id ?? null;
  }

  if (!profileId) {
    // Without a profile the invitee could sign in to nothing — take the auth
    // user back out rather than leave an orphan (0002 explains orphans).
    await supabase.auth.admin.deleteUser(authUserId);
    return {
      ok: false,
      error: "The account was created but its profile never appeared (is the handle_new_user trigger installed?). It was removed again.",
    };
  }

  const patch: Record<string, unknown> = { role: "admin", status: "active" };
  if (hasColumn) patch.is_super_admin = level === "super";
  const { error: roleError } = await supabase.from("profiles").update(patch).eq("id", profileId);

  if (roleError) {
    console.error("[admins:add] set role", roleError.message);
    await supabase.auth.admin.deleteUser(authUserId);
    return { ok: false, error: "Could not make the new account an administrator. It was removed again." };
  }

  await writeAudit(admin, {
    action: "admin.grant",
    entityType: "profile",
    entityId: profileId,
    summary: `Invited ${email} as a ${level} administrator`,
    metadata: { email, level, invited: true },
  });

  const inviteUrl =
    `${await siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}` +
    `&type=invite&next=${encodeURIComponent("/reset-password")}`;
  const brand = await getBranding();
  const mail = await trySendMail({
    to: email,
    subject: `Your administrator account on ${brand.name}`,
    body: [
      name ? `Hello ${name.split(" ")[0]},` : "Hello,",
      "",
      `${admin.name} invited you to administer ${brand.name} as a${level === "super" ? " super" : "n"} administrator.`,
      "Open the link below to choose your password, then sign in — the administration area is at /a.",
      "",
      inviteUrl,
      "",
      "The link works once and expires. If it has expired, use “Forgot password” on the sign-in page with this address.",
      "",
      `— The ${brand.name} team`,
    ].join("\n"),
    action: { label: "Choose my password", url: inviteUrl },
    locale: "en",
  });

  revalidatePath("/a/admins");
  revalidatePath("/a/users");
  return {
    ok: true,
    note: mail.sent
      ? `Invitation sent to ${email}.`
      : `Account created, but the invitation email was not sent (${mail.reason}). ${email} can use “Forgot password” on the sign-in page to set a password.`,
  };
}

/* ── Promote / demote ──────────────────────────────────────────────────── */

export async function setAdministratorLevel(profileId: string, level: AdminLevel): Promise<ActionResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  const [target, admins] = await Promise.all([loadSubject(profileId), loadAdminSubjects()]);
  if (!target) return { ok: false, error: "Administrator not found." };
  if (!admins) return { ok: false, error: "Could not read the administrators. Nothing was changed." };

  const change: AdminChange = level === "super" ? { kind: "promote" } : { kind: "demote" };
  const verdict = canChangeAdmin({ actor: subjectOf(admin), target, change, admins });
  if (!verdict.ok) return verdict;

  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ is_super_admin: level === "super" })
    .eq("id", profileId)
    .eq("role", "admin")
    .select("id, email")
    .maybeSingle();

  if (superAdminColumnMissing(error)) return { ok: false, error: MIGRATION_MISSING };
  if (error || !updated) {
    if (error) console.error("[admins:setLevel]", error.message);
    return { ok: false, error: "Could not change the level." };
  }

  if (level === "simple") {
    const undone = await confirmSuperAdminRemains(() =>
      supabase.from("profiles").update({ is_super_admin: true }).eq("id", profileId),
    );
    if (undone) return undone;
  }

  const email = (updated as { email: string }).email;
  await writeAudit(admin, {
    action: level === "super" ? "admin.promote" : "admin.demote",
    entityType: "profile",
    entityId: profileId,
    summary: level === "super" ? `Promoted ${email} to super administrator` : `Demoted ${email} to simple administrator`,
    metadata: { email, level },
  });

  revalidatePath("/a/admins");
  return { ok: true };
}

/* ── Remove ────────────────────────────────────────────────────────────── */

/**
 * Take administrator rights away. The ACCOUNT stays — role back to
 * 'customer', flag cleared — so their orders and history are untouched; use
 * /a/users to suspend or anonymise the account itself. Takes effect on their
 * very next request, because requireRole re-reads the profile every time.
 */
export async function removeAdministrator(profileId: string): Promise<ActionResult> {
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const admin = gate.admin;

  const [target, admins] = await Promise.all([loadSubject(profileId), loadAdminSubjects()]);
  if (!target) return { ok: false, error: "Administrator not found." };
  if (!admins) return { ok: false, error: "Could not read the administrators. Nothing was changed." };

  const verdict = canChangeAdmin({ actor: subjectOf(admin), target, change: { kind: "remove" }, admins });
  if (!verdict.ok) return verdict;

  const supabase = createAdminClient();
  const probe = await supabase.from("profiles").select("is_super_admin").limit(1);
  const hasColumn = !superAdminColumnMissing(probe.error);

  const patch: Record<string, unknown> = { role: "customer" };
  if (hasColumn) patch.is_super_admin = false;

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", profileId)
    .eq("role", "admin")
    .select("id, email")
    .maybeSingle();

  if (error || !updated) {
    if (error) console.error("[admins:remove]", error.message);
    return { ok: false, error: "Could not remove the administrator rights." };
  }

  const undone = await confirmSuperAdminRemains(() =>
    supabase
      .from("profiles")
      .update(hasColumn ? { role: "admin", is_super_admin: target.isSuperAdmin } : { role: "admin" })
      .eq("id", profileId),
  );
  if (undone) return undone;

  const email = (updated as { email: string }).email;
  await writeAudit(admin, {
    action: "admin.remove",
    entityType: "profile",
    entityId: profileId,
    summary: `Removed administrator rights from ${email}`,
    metadata: {
      email,
      wasSuperAdmin: effectiveSuperAdmin("admin", hasColumn ? target.isSuperAdmin : undefined),
    },
  });

  revalidatePath("/a/admins");
  revalidatePath("/a/users");
  return { ok: true };
}
