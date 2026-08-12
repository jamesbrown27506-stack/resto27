"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Mail, PlugZap, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBody, Panel } from "@/components/ui/card";
import { sendTestEmail, testMailConnection } from "@/lib/data/mail-actions";

/**
 * The one thing the rest of this page deliberately will not do: talk to the
 * outside world.
 *
 * Everything above is passive so it stays safe to open during an incident.
 * Proving SMTP works needs a real connection, so it lives behind a button —
 * you choose the moment.
 */
export function MailTester({ adminEmail }: { adminEmail: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setResult(null);
    startTransition(async () => setResult(await action()));
  }

  return (
    <Panel
      title="Email delivery"
      description="Two real checks. Nothing else on this page leaves the server."
    >
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run(testMailConnection)}>
            <PlugZap className="size-4" aria-hidden />
            <span>Test connection</span>
          </Button>

          {/*
            Sent to the signed-in admin, and to nobody else. A test that lets
            you type any address is a test that eventually gets pointed at a
            customer.
          */}
          <Button disabled={pending} loading={pending} onClick={() => run(sendTestEmail)}>
            <Send className="size-4" aria-hidden />
            <span>Send test email to me</span>
          </Button>
        </div>

        <p className="flex items-center gap-2 text-xs text-text-light">
          <Mail className="size-3.5 shrink-0" aria-hidden />
          The test message goes to {adminEmail}.
        </p>

        {result && (
          <div
            role="status"
            className={
              result.ok
                ? "flex items-start gap-2.5 rounded-md border border-success/30 bg-success-light p-3 text-sm text-success"
                : "flex items-start gap-2.5 rounded-md border border-error/30 bg-error-light p-3 text-sm text-error"
            }
          >
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span>{result.message}</span>
          </div>
        )}
      </CardBody>
    </Panel>
  );
}
