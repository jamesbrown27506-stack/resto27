import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/i18n/use-locale", () => ({ useLocale: () => ({ locale: "fr" }) }));
vi.mock("@/lib/auth/security-actions", () => ({ disableOwnAuthenticator: vi.fn(), enrollOwnAuthenticator: vi.fn(), sendOwnEmailCode: vi.fn(), verifyOwnAuthenticator: vi.fn(), verifyOwnEmailCode: vi.fn() }));
import { SecurityClient } from "./security-client";
const base = { email: "test@example.com", verified: false, factors: [], assured: false, emailRequired: true, next: "/m" };
const render = (props = {}) => renderToStaticMarkup(createElement(SecurityClient, { ...base, ...props }));
const button = (html: string, label: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2].includes(label));
describe("security page access and form contracts", () => {
  it("renders a real submit button and a code field even before requesting another email", () => {
    const html = render();
    expect(html).toContain('name="emailCode"');
    expect(button(html, "Vérifier le code")?.[1]).toContain('type="submit"');
    expect(button(html, "Se déconnecter")?.[1]).toContain('type="submit"');
  });
  it("allows a verified restaurant or admin to continue without enrolling 2FA", () => {
    const html = render({ verified: true });
    expect(button(html, "Continuer sans 2FA")).toBeDefined();
    expect(button(html, "Activer la 2FA")).toBeDefined();
    expect(html).toContain("facultative pour tous les comptes");
  });
  it("keeps email verification separate from enrollment", () => {
    expect(button(render(), "Continuer sans 2FA")).toBeUndefined();
    expect(button(render({ emailRequired: false }), "Continuer sans 2FA")).toBeDefined();
    expect(button(render({ emailRequired: false, verified: true }), "Activer la 2FA")).toBeDefined();
  });
  it("requires the code for opted-in accounts and makes its confirmation a submit button", () => {
    const html = render({ verified: true, factors: [{ id: "factor", name: "App" }] });
    expect(button(html, "Continuer")).toBeUndefined();
    expect(button(html, "Confirmer le code")?.[1]).toContain('type="submit"');
  });
  it("offers disable and continue only after the opted-in account has verified 2FA", () => {
    const html = render({ verified: true, assured: true, factors: [{ id: "factor", name: "App" }] });
    expect(button(html, "Désactiver la 2FA")).toBeDefined();
    expect(button(html, "Continuer")).toBeDefined();
  });
});
