"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, HardDriveUpload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { probeStorage, type StorageProbeResult } from "./storage-actions";

/**
 * The upload path, exercised for real.
 *
 * The passive check on /a/tests can only tell you the bucket EXISTS. This
 * stores an actual object, fetches it back over the public URL the browser
 * would use, and deletes it — which is the only way to catch the failures that
 * matter in between: a bucket that exists but is private, a MIME type the
 * bucket rejects, or a CDN that has not propagated.
 *
 * Deliberately here and not on the passive page: it writes.
 */
export function StorageProbe() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<StorageProbeResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => setResult(await probeStorage()));
  }

  return (
    <CardBody className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-text-secondary">
        Uploads a 68-byte PNG, fetches it back over its public URL, then deletes it. Proves the
        whole path a real logo takes — the bucket, its MIME rules, and whether the CDN actually
        serves what was stored.
      </p>

      <Button onClick={run} loading={pending} className="self-start">
        <HardDriveUpload className="size-4" aria-hidden />
        <span>Run the upload probe</span>
      </Button>

      {result && (
        <ul className="flex flex-col gap-2 border-t border-border pt-4">
          {result.steps.map((step) => (
            <li key={step.name} className="flex items-start gap-2.5 text-sm">
              {step.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
              )}
              <span className="min-w-0">
                <span className="font-medium">{step.name}</span>
                <span className={cn("block", step.ok ? "text-text-secondary" : "text-error")}>
                  {step.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </CardBody>
  );
}
