"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";

/**
 * Sign out, with a confirmation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A FORM POST, NOT A LINK — and that is a security fix, not a style choice.
 *
 *  The manager sidebar used `<Link href="/logout">`. A GET route that changes
 *  state can be fired by anything that loads a URL: an `<img src="/logout">`
 *  in a review, an email, or any page the user happens to open. Signing
 *  someone out is a mild version of the attack, but the route is the same
 *  shape as the dangerous ones and should not teach the pattern.
 *
 *  The confirmation exists because logging out mid-service is genuinely
 *  costly: a kitchen tablet signed out during the dinner rush needs someone
 *  who knows the password, and they are usually not in the kitchen.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function LogoutButton({
  variant = "icon",
  className,
}: {
  /** `icon` for a toolbar, `full` for a sidebar row, `block` for a drawer's full-width button. */
  variant?: "icon" | "full" | "block";
  className?: string;
}) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={formRef} action="/logout" method="post" className={variant === "icon" ? undefined : "w-full"}>
        {variant === "block" ? (
          <Button type="button" variant="outline" fullWidth className={className} onClick={() => setConfirming(true)}>
            <LogOut className="size-4" aria-hidden />
            <span>{t("nav.logout")}</span>
          </Button>
        ) : variant === "icon" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("nav.logout")}
            title={t("nav.logout")}
            className={cn("text-text-light hover:bg-error-light hover:text-error", className)}
            onClick={() => setConfirming(true)}
          >
            <LogOut className="size-4" aria-hidden />
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-text-light transition-colors hover:bg-error-light hover:text-error",
              className,
            )}
          >
            <LogOut className="size-4" aria-hidden />
            <span>{t("nav.logout")}</span>
          </button>
        )}
      </form>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          // Submitting the form rather than calling an action: the POST route
          // clears the cookie and redirects in one server round trip, with no
          // window where the client thinks it is signed out and the server
          // disagrees.
          formRef.current?.requestSubmit();
        }}
        title={t("logout.title")}
        message={t("logout.message")}
        confirmLabel={t("nav.logout")}
        cancelLabel={t("common.cancel")}
      />
    </>
  );
}
