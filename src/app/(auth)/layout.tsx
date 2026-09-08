import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
import { AuthShell } from "./auth-shell";
import { getBranding } from "@/lib/branding";

/**
 * A server layout wrapping a client shell.
 *
 * The shell itself has to be a client component — it translates its copy with
 * useLocale and carries the theme and language toggles. But branding lives in
 * the database, and a client component cannot read it. Splitting the two is
 * the whole reason this file exists: the server fetches, the client renders.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBranding();

  return <AuthShell brand={brand}>{children}</AuthShell>;
}
