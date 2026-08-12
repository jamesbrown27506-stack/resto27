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

  return (
    <AdminPage
      title="CamerPay"
      description="Mobile money integration — authentication, callbacks and live transaction tests."
    >
      <CamerPayConsole suggestedCallback={suggested} />
    </AdminPage>
  );
}
