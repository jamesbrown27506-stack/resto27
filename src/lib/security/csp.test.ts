import { expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";
it("requires a nonce for production scripts and disallows inline/eval execution", () => {
  const policy = contentSecurityPolicy({ production: true, nonce: "random-nonce", supabaseUrl: "https://project.supabase.co" });
  const scripts = policy.split(";").find(part => part.trim().startsWith("script-src"))!;
  expect(scripts).toContain("'nonce-random-nonce'"); expect(scripts).toContain("'strict-dynamic'");
  expect(scripts).not.toContain("'unsafe-inline'"); expect(scripts).not.toContain("'unsafe-eval'");
  expect(policy).toContain("object-src 'none'"); expect(policy).toContain("frame-ancestors 'none'");
});
