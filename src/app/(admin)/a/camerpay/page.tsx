import { headers } from "next/headers";
import { AdminPage } from "@/components/layout/admin-shell";
import { CamerPayConsole } from "./console";

export const dynamic = "force-dynamic";

export default async function CamerPayPage() {
  // Base URL derived from the request, never a constant (§11) — a stale
  // configured value fails in a uniquely confusing way.
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const suggested = `https://${host}/api/webhooks/camerpay`;

  /**
   * WHICH BUILD IS THIS.
   *
   * Three fixes were shipped while the same symptom persisted, and there was
   * no way from the screen to tell a fix that did not work from a fix that had
   * not deployed. Vercel injects the commit; printing seven characters of it
   * ends that ambiguity for good.
   */
  const build =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    (process.env.NODE_ENV === "development" ? "dev" : "unknown");

  return (
    <AdminPage
      title="CamerPay"
      description="Mobile money integration — authentication, callbacks and live transaction tests."
    >
      <CamerPayConsole suggestedCallback={suggested} build={build} />
    </AdminPage>
  );
}
