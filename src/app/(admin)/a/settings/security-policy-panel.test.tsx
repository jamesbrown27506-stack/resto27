import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ super: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/use-locale", () => ({ useLocale: () => ({ locale: "fr" }) }));
vi.mock("@/components/layout/admin-shell", () => ({ useIsSuperAdmin: mocks.super, SuperAdminOnlyHint: () => "Super admin only" }));
vi.mock("@/lib/data/security-policy-actions", () => ({ saveEmailVerificationPolicy: vi.fn() }));
import { SecurityPolicyPanel } from "./security-policy-panel";
import { DEFAULT_EMAIL_POLICY } from "@/lib/auth/email-policy-rules";
beforeEach(() => mocks.super.mockReturnValue(true));
it("shows the three account choices with admin/restaurant required and customers optional", () => {
  const html = renderToStaticMarkup(createElement(SecurityPolicyPanel, { initial: DEFAULT_EMAIL_POLICY }));
  expect(html).toContain("Administrateurs"); expect(html).toContain("Comptes restaurant"); expect(html).toContain("Clients");
  const inputs = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(match => match[0]);
  expect(inputs).toHaveLength(3); expect(inputs.map(input => input.includes('checked=""'))).toEqual([true, true, false]);
  expect(html).toContain('type="submit"'); expect(html).toContain("2FA reste facultative pour tout le monde");
});
it("shows persisted choices rather than resetting the administrator's policy", () => {
  const html = renderToStaticMarkup(createElement(SecurityPolicyPanel, { initial: { admin: false, manager: false, customer: true } }));
  const inputs = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(match => match[0]);
  expect(inputs.map(input => input.includes('checked=""'))).toEqual([false, false, true]);
});
it("makes all verification switches read-only for simple administrators", () => {
  mocks.super.mockReturnValue(false);
  const html = renderToStaticMarkup(createElement(SecurityPolicyPanel, { initial: DEFAULT_EMAIL_POLICY }));
  expect(html).toContain('<fieldset disabled=""'); expect(html).toContain("Super admin only");
});
