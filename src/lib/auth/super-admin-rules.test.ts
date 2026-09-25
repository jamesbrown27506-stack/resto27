import { describe, expect, it } from "vitest";
import {
  canChangeAdmin,
  canModerateAccount,
  countActiveSuperAdmins,
  criticalKeysIn,
  effectiveSuperAdmin,
  isCriticalSettingKey,
  isGatewaySettingKey,
  isPlausibleEmail,
  normaliseEmail,
  SUPER_ADMIN_ONLY_ERROR,
  superAdminColumnMissing,
  type AdminSubject,
} from "./super-admin-rules";

function admin(id: string, over: Partial<AdminSubject> = {}): AdminSubject {
  return { id, role: "admin", isSuperAdmin: false, status: "active", deletedAt: null, ...over };
}

const superA = admin("a", { isSuperAdmin: true });
const superB = admin("b", { isSuperAdmin: true });
const simpleC = admin("c");
const customer = { ...admin("d"), role: "customer" };
const manager = { ...admin("e"), role: "manager" };

describe("critical settings", () => {
  it.each([
    "payment_mode",
    "payment_provider_collect",
    "payment_provider_payout",
    "service_charge_percent",
    "withdrawal_fee_enabled",
    "withdrawal_fee_percent",
    "refunds_to_wallet",
    "platform_free_mode",
    "platform_free_mode_days",
    "platform_free_mode_until",
    "cron_base_url",
    "cron_secret",
    "push_provider",
    "order_response_minutes",
    "reservation_response_minutes",
    "subscription_grace_days",
    "platform_delivery_fee",
    "loyalty_point_value",
  ])("%s is super-admin only", (key) => {
    expect(isCriticalSettingKey(key)).toBe(true);
  });

  it.each(["brand_name", "brand_logo_url", "social_x_url", "support_email", "notification_sound", "home_payment_image", "home_stat_orders"])(
    "%s stays open to every admin",
    (key) => {
      expect(isCriticalSettingKey(key)).toBe(false);
    },
  );

  it("fails closed for future money-looking keys", () => {
    expect(isCriticalSettingKey("online_payment_fee")).toBe(true);
    expect(isCriticalSettingKey("payout_minimum")).toBe(true);
    expect(isCriticalSettingKey("mail_api_secret")).toBe(true);
  });

  it("lists only the critical keys of a change set", () => {
    expect(criticalKeysIn({ brand_name: "X", payment_mode: "live", support_phone: "1" })).toEqual(["payment_mode"]);
    expect(criticalKeysIn({ brand_name: "X" })).toEqual([]);
  });

  it("recognises the gateway keys", () => {
    expect(isGatewaySettingKey("payment_provider_collect")).toBe(true);
    expect(isGatewaySettingKey("payment_provider_payout")).toBe(true);
    expect(isGatewaySettingKey("payment_mode")).toBe(false);
  });
});

describe("canChangeAdmin", () => {
  const admins = [superA, superB, simpleC];

  it("refuses every change from a simple admin", () => {
    for (const change of [{ kind: "promote" }, { kind: "demote" }, { kind: "remove" }, { kind: "grant", level: "simple" }] as const) {
      const result = canChangeAdmin({ actor: simpleC, target: superB, change, admins });
      expect(result).toEqual({ ok: false, error: SUPER_ADMIN_ONLY_ERROR });
    }
  });

  it("refuses a suspended super admin", () => {
    const suspended = { ...superA, status: "suspended" };
    expect(canChangeAdmin({ actor: suspended, target: simpleC, change: { kind: "promote" }, admins }).ok).toBe(false);
  });

  it("lets a super admin promote a simple admin", () => {
    expect(canChangeAdmin({ actor: superA, target: simpleC, change: { kind: "promote" }, admins })).toEqual({ ok: true });
  });

  it("will not promote a suspended admin", () => {
    const target = { ...simpleC, status: "suspended" };
    expect(canChangeAdmin({ actor: superA, target, change: { kind: "promote" }, admins }).ok).toBe(false);
  });

  it("lets a super admin demote or remove another super admin while one remains", () => {
    expect(canChangeAdmin({ actor: superA, target: superB, change: { kind: "demote" }, admins }).ok).toBe(true);
    expect(canChangeAdmin({ actor: superA, target: superB, change: { kind: "remove" }, admins }).ok).toBe(true);
  });

  it("never lets a super admin demote or remove themselves", () => {
    expect(canChangeAdmin({ actor: superA, target: superA, change: { kind: "demote" }, admins }).ok).toBe(false);
    expect(canChangeAdmin({ actor: superA, target: superA, change: { kind: "remove" }, admins }).ok).toBe(false);
  });

  it("keeps at least one active super admin", () => {
    // B is the only other super, but suspended — A is the last active one.
    const onlyA = [superA, { ...superB, status: "suspended" }, simpleC];
    // Demoting the suspended B is fine: they do not count.
    expect(canChangeAdmin({ actor: superA, target: onlyA[1], change: { kind: "demote" }, admins: onlyA }).ok).toBe(true);
    expect(countActiveSuperAdmins(onlyA)).toBe(1);
  });

  it("removing a simple admin never trips the last-super guard", () => {
    expect(canChangeAdmin({ actor: superA, target: simpleC, change: { kind: "remove" }, admins: [superA, simpleC] }).ok).toBe(true);
  });

  it("grants to a customer but refuses a restaurant account or an existing admin", () => {
    expect(canChangeAdmin({ actor: superA, target: customer, change: { kind: "grant", level: "super" }, admins }).ok).toBe(true);
    expect(canChangeAdmin({ actor: superA, target: manager, change: { kind: "grant", level: "simple" }, admins }).ok).toBe(false);
    expect(canChangeAdmin({ actor: superA, target: simpleC, change: { kind: "grant", level: "super" }, admins }).ok).toBe(false);
  });

  it("refuses to act on a deleted account", () => {
    const deleted = { ...customer, deletedAt: "2026-01-01T00:00:00Z" };
    expect(canChangeAdmin({ actor: superA, target: deleted, change: { kind: "grant", level: "simple" }, admins }).ok).toBe(false);
  });
});

describe("canModerateAccount", () => {
  const admins = [superA, simpleC];

  it("lets any admin moderate a customer or manager", () => {
    expect(canModerateAccount({ actor: simpleC, target: customer, action: "suspend", admins }).ok).toBe(true);
    expect(canModerateAccount({ actor: simpleC, target: manager, action: "anonymise", admins }).ok).toBe(true);
  });

  it("stops a simple admin from touching an administrator's account", () => {
    expect(canModerateAccount({ actor: simpleC, target: superA, action: "suspend", admins }).ok).toBe(false);
    expect(canModerateAccount({ actor: simpleC, target: simpleC, action: "reinstate", admins }).ok).toBe(false);
  });

  it("never suspends or deletes the last active super admin", () => {
    const other = admin("z", { isSuperAdmin: true });
    // A super admin acting on the only active super (someone else).
    expect(canModerateAccount({ actor: other, target: superA, action: "suspend", admins: [superA, other] }).ok).toBe(true);
    expect(
      canModerateAccount({ actor: other, target: superA, action: "suspend", admins: [superA, { ...other, status: "suspended" }] }).ok,
    ).toBe(false);
  });

  it("lets a super admin suspend a simple admin", () => {
    expect(canModerateAccount({ actor: superA, target: simpleC, action: "suspend", admins }).ok).toBe(true);
  });
});

describe("migration tolerance", () => {
  it("detects the missing column on read and write", () => {
    expect(superAdminColumnMissing({ code: "42703", message: "column profiles.is_super_admin does not exist" })).toBe(true);
    expect(
      superAdminColumnMissing({ code: "PGRST204", message: "Could not find the 'is_super_admin' column of 'profiles' in the schema cache" }),
    ).toBe(true);
    expect(superAdminColumnMissing({ code: "42703", message: "column profiles.other does not exist" })).toBe(false);
    expect(superAdminColumnMissing(null)).toBe(false);
  });

  it("treats every admin as super before 0063, and only admins ever", () => {
    expect(effectiveSuperAdmin("admin", undefined)).toBe(true);
    expect(effectiveSuperAdmin("admin", false)).toBe(false);
    expect(effectiveSuperAdmin("admin", true)).toBe(true);
    expect(effectiveSuperAdmin("customer", true)).toBe(false);
    expect(effectiveSuperAdmin("manager", undefined)).toBe(false);
  });
});

describe("email helpers", () => {
  it("normalises and validates", () => {
    expect(normaliseEmail("  Jane@Example.COM ")).toBe("jane@example.com");
    expect(isPlausibleEmail("jane@example.com")).toBe(true);
    expect(isPlausibleEmail("jane@example")).toBe(false);
    expect(isPlausibleEmail("not an email")).toBe(false);
  });
});
