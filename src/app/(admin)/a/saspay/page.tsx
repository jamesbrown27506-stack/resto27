import { headers } from "next/headers";
import { AdminPage } from "@/components/layout/admin-shell";
import { requireRole } from "@/lib/auth/session";
import { saspayConfigured, saspayKeyEnvironment } from "@/lib/payments/saspay/client";
import { SaspayConsole } from "./console";

export const dynamic = "force-dynamic";

export default async function SaspayPage() {
  await requireRole("admin");
  // Derived from the request, like the CamerPay console's callback URL.
  const host = (await headers()).get("host") ?? "localhost:3000";

  return (
    <AdminPage
      title="SasPay"
      description="Second Cameroon gateway — connection, rates, balance and live transaction tests (MTN MoMo / Orange Money)."
    >
      <SaspayConsole
        configured={saspayConfigured()}
        environment={saspayKeyEnvironment()}
        webhookSecretSet={Boolean(process.env.SASPAY_WEBHOOK_SECRET?.trim())}
        webhookUrl={`https://${host}/api/webhooks/saspay`}
      />
    </AdminPage>
  );
}
