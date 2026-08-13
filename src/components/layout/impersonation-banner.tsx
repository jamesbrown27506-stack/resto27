"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { VenetianMask, X } from "lucide-react";
import { endImpersonation } from "@/lib/data/platform-actions";

/**
 * The impersonation banner (§8).
 *
 * LOUD AND UNDISMISSABLE, by design. There is no close button — only "stop",
 * which ends the session and writes the closing audit row. A banner you can
 * dismiss is a banner you forget, and forgetting means an admin's actions keep
 * accumulating against a tenant's name.
 *
 * `sticky top-0` with a high z-index so it survives scrolling and sits above
 * the page header.
 */
export function ImpersonationBanner({
  adminName,
  targetName,
}: {
  adminName: string;
  targetName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-3 border-b-2 border-accent-hover bg-accent px-4 py-2.5 text-accent-fg"
    >
      <VenetianMask className="size-4 shrink-0" aria-hidden />

      <p className="min-w-0 flex-1 text-sm font-semibold">
        <span>You are viewing the platform as </span>
        <strong className="underline">{targetName}</strong>
        <span>.</span>
        <span className="ml-2 font-normal opacity-85">
          <span>Every action is recorded against </span>
          <span>{adminName}</span>
          <span> as the impersonator.</span>
        </span>
      </p>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await endImpersonation();
            // Back where impersonation is managed. Without this, stopping
            // while on /m leaves an admin with no branches staring at the
            // "no branch" page.
            router.push("/a/impersonate");
          })
        }
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-fg/15 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-accent-fg/25 disabled:opacity-60"
      >
        <X className="size-3.5" aria-hidden />
        <span>{pending ? "Stopping…" : "Stop impersonating"}</span>
      </button>
    </div>
  );
}
