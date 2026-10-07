/**
 * Super administrators — the pure rules.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TWO LEVELS OF ADMINISTRATOR (migration 0063).
 *
 *    simple admin — runs the platform day to day: approves and suspends
 *                   restaurants, moderates reviews, answers support, sends
 *                   broadcasts, cancels and refunds a disputed order.
 *    super admin  — additionally holds every switch that MOVES MONEY or
 *                   CHANGES HOW THE PLATFORM WORKS: gateway and payment mode,
 *                   fees, refund destination, wallet credits, withdrawals,
 *                   manual refunds, plan prices, impersonation, deleting
 *                   accounts — and who is an administrator at all.
 *
 *  The split exists because one compromised or careless admin login used to
 *  be able to do all of it. Day-to-day work stays open to everyone so the
 *  second level is not a bottleneck; only the irreversible or money-moving
 *  operations are held back.
 *
 *  This module is plain on purpose — no "use server", no server-only, no
 *  Supabase — so every rule here is unit-tested (super-admin-rules.test.ts)
 *  and the server actions only call it.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const SUPER_ADMIN_ONLY_ERROR = "Only a super administrator can change this.";

export const GATEWAY_SETTING_ERROR = "Use Payments → Gateways to change the payment gateway.";

/* ── Settings ──────────────────────────────────────────────────────────── */

/**
 * The payment-gateway switches. Refused by the generic settings form for
 * EVERYONE, super admins included: flipping a gateway needs the dedicated
 * panel's checks (keys configured, payout IP whitelisted), not a text box.
 */
export const GATEWAY_SETTING_KEYS: ReadonlySet<string> = new Set([
  "payment_provider_collect",
  "payment_provider_payout",
]);

export function isGatewaySettingKey(key: string): boolean {
  return GATEWAY_SETTING_KEYS.has(key);
}

/**
 * Settings only a super admin may change.
 *
 * Chosen from every settings row seeded by supabase/migrations/*.sql. The
 * test for inclusion: does changing it move money, change what someone is
 * charged or paid, hand out paid service for free, or weaken a security
 * boundary? Branding, social links, the home-page figures, the notification
 * sound and the support contact details do none of those and stay open.
 */
export const CRITICAL_SETTING_KEYS: ReadonlySet<string> = new Set([
  // Payments — whether real money moves, and through whom.
  "payment_mode",
  "payments_enabled",
  "payment_provider",
  "payment_provider_collect",
  "payment_provider_payout",
  "default_currency",
  // Fees and charges — what customers and restaurants pay.
  "service_charge_percent",
  "platform_delivery_fee",
  "withdrawal_fee_enabled",
  "withdrawal_fee_percent",
  // Where refunds land (wallet vs Mobile Money).
  "refunds_to_wallet",
  // Free service — every tenant stops paying while it is on.
  "platform_free_mode",
  "platform_free_mode_days",
  "platform_free_mode_until",
  "subscription_grace_days",
  // Money-valued programmes.
  "platform_coupons_enabled",
  "loyalty_enabled",
  "loyalty_point_value",
  "loyalty_min_redeem",
  // Timers that auto-cancel (and so auto-refund) orders and reservations.
  "order_response_minutes",
  "reservation_response_minutes",
  // Security and delivery plumbing.
  "cron_base_url",
  "cron_secret",
  "push_provider",
  "email_verification_roles",
  // Locks every installed Android app out until it updates.
  "app_update_required",
]);

/**
 * Keys added LATER that look like money or secrets are critical by default.
 * Failing closed: a new `foo_fee_percent` row is super-only until someone
 * deliberately decides otherwise, rather than open until someone notices.
 */
const CRITICAL_KEY_PATTERN = /(^payment|payout|_fee|fee_|commission|free_mode|^cron_|secret|token|refund|withdrawal|wallet)/;

export function isCriticalSettingKey(key: string): boolean {
  return CRITICAL_SETTING_KEYS.has(key) || CRITICAL_KEY_PATTERN.test(key);
}

/** The critical keys in a settings change set, in the order given. */
export function criticalKeysIn(changes: Record<string, unknown>): string[] {
  return Object.keys(changes).filter(isCriticalSettingKey);
}

/* ── Administrator management ──────────────────────────────────────────── */

export type AdminLevel = "simple" | "super";

/** The minimum a rule needs to know about one profile. */
export interface AdminSubject {
  id: string;
  role: string;
  isSuperAdmin: boolean;
  status: string;
  deletedAt: string | null;
}

export type RuleResult = { ok: true } | { ok: false; error: string };

/** An admin who can actually sign in and act — the only kind that counts. */
export function isActiveSuperAdmin(p: AdminSubject): boolean {
  return p.role === "admin" && p.isSuperAdmin && p.status === "active" && !p.deletedAt;
}

export function countActiveSuperAdmins(profiles: readonly AdminSubject[]): number {
  return profiles.filter(isActiveSuperAdmin).length;
}

export type AdminChange =
  /** Make someone an administrator (new or existing account). */
  | { kind: "grant"; level: AdminLevel }
  | { kind: "promote" }
  | { kind: "demote" }
  /** Take admin rights away entirely (role back to customer). */
  | { kind: "remove" };

/**
 * May `actor` apply `change` to `target`?
 *
 * `admins` is every admin profile as it is NOW (before the change) — used to
 * make sure the platform always keeps at least one active super admin. Losing
 * the last one would leave nobody able to change a fee, approve a withdrawal
 * or appoint a replacement, and the only way back would be hand-written SQL.
 */
export function canChangeAdmin(input: {
  actor: AdminSubject;
  target: AdminSubject;
  change: AdminChange;
  admins: readonly AdminSubject[];
}): RuleResult {
  const { actor, target, change, admins } = input;

  if (!isActiveSuperAdmin(actor)) return { ok: false, error: SUPER_ADMIN_ONLY_ERROR };

  if (target.deletedAt) return { ok: false, error: "That account has been deleted." };

  const self = actor.id === target.id;

  switch (change.kind) {
    case "grant": {
      if (target.role === "admin") {
        return { ok: false, error: "That person is already an administrator." };
      }
      if (target.role === "manager") {
        // A restaurant login carrying platform powers would let one tenant
        // see and change every other tenant. Separate accounts, always.
        return {
          ok: false,
          error:
            "That account works at a restaurant. Use a separate email address for the administrator account.",
        };
      }
      return { ok: true };
    }

    case "promote": {
      if (target.role !== "admin") return { ok: false, error: "That person is not an administrator." };
      if (target.isSuperAdmin) return { ok: false, error: "Already a super administrator." };
      if (target.status !== "active") {
        return { ok: false, error: "Reinstate the account before promoting it." };
      }
      return { ok: true };
    }

    case "demote":
    case "remove": {
      if (target.role !== "admin") return { ok: false, error: "That person is not an administrator." };
      if (self) {
        // Not a rule about power — about mistakes. Nobody should be able to
        // lock themselves out with one click; another super admin can do it.
        return {
          ok: false,
          error:
            change.kind === "demote"
              ? "You cannot demote yourself. Ask another super administrator."
              : "You cannot remove your own administrator rights. Ask another super administrator.",
        };
      }
      if (change.kind === "demote" && !target.isSuperAdmin) {
        return { ok: false, error: "Already a simple administrator." };
      }
      if (isActiveSuperAdmin(target) && countActiveSuperAdmins(admins) <= 1) {
        return { ok: false, error: "The platform must keep at least one active super administrator." };
      }
      return { ok: true };
    }
  }
}

/**
 * May `actor` suspend or delete (anonymise) `target`'s account?
 *
 * Moderating customers and restaurant staff is ordinary admin work. An
 * ADMINISTRATOR's account is different: a simple admin who could suspend a
 * super admin could lock the people above them out of the platform, so that
 * takes a super admin — and the last active super admin is never taken out.
 */
export function canModerateAccount(input: {
  actor: AdminSubject;
  target: AdminSubject;
  action: "suspend" | "reinstate" | "anonymise";
  admins: readonly AdminSubject[];
}): RuleResult {
  const { actor, target, action, admins } = input;

  if (target.role !== "admin") return { ok: true };

  if (!isActiveSuperAdmin(actor)) {
    return { ok: false, error: "Only a super administrator can change another administrator's account." };
  }

  if (action !== "reinstate" && isActiveSuperAdmin(target) && countActiveSuperAdmins(admins) <= 1) {
    return { ok: false, error: "The platform must keep at least one active super administrator." };
  }

  return { ok: true };
}

/* ── Migration tolerance ───────────────────────────────────────────────── */

/**
 * "profiles.is_super_admin does not exist yet" — migration 0063 not run.
 *
 * Both shapes (see lib/data/missing-column.test.ts): Postgres 42703 on a read,
 * PostgREST PGRST204 on a write, which PostgREST refuses against its own
 * schema cache before Postgres is asked.
 */
export function superAdminColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const known = error.code === "42703" || error.code === "PGRST204";
  return known && (error.message ?? "").includes("is_super_admin");
}

/**
 * The effective flag. Only an ADMIN can be super — a stray `true` on a
 * customer row grants nothing. Before 0063 runs (`raw` undefined) every admin
 * counts as super, which is exactly what the migration will set: nobody is
 * locked out of the switches they had yesterday.
 */
export function effectiveSuperAdmin(role: string, raw: boolean | null | undefined): boolean {
  if (role !== "admin") return false;
  return raw === undefined ? true : raw === true;
}

/* ── Email ─────────────────────────────────────────────────────────────── */

export function normaliseEmail(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
