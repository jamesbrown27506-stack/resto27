"use client";

import Link from "@/components/layout/public-link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { NavIcon } from "./icon";
import { LogoutButton } from "./logout-button";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { AccountLink } from "@/lib/account-links";

/**
 * The avatar in the top bar, and the small panel it opens.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT USED TO BE A PLAIN LINK — AND ON A PHONE IT SEEMED TO DO NOTHING.
 *
 *  The customer's avatar went to /account, which is where they usually
 *  already were; the manager's went straight to the restaurant's profile,
 *  which is not the profile a person means when they tap their own face.
 *  A tap on your own picture should answer "who am I signed in as" first:
 *  name, email, phone, then the places that change them, then sign-out.
 *
 *  Sign-out lives here rather than as a separate icon in the bar: on a
 *  360 px phone that icon sat between the bell and the avatar, one slip away
 *  from a confirmation nobody wanted mid-service.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Right-aligned under the avatar, which is always the last control in the
 * bar, so on a phone the panel opens leftwards and stays on screen.
 */
export function AccountMenu({
  name,
  email,
  phone,
  avatarUrl,
  subtitle,
  links,
}: {
  name: string;
  email: string;
  phone?: string | null;
  avatarUrl: string | null;
  /** Staff: their role and restaurant — "Propriétaire · Chez Marcel". */
  subtitle?: string;
  links: AccountLink[];
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Close on navigation — adjusted during render, as the shells do, so the
  // panel never paints over the page it just led to.
  const [openedOn, setOpenedOn] = useState(pathname);
  if (open && openedOn !== pathname) {
    setOpen(false);
    setOpenedOn(pathname);
  }

  // Outside tap and Escape close it — a panel that only its own button can
  // dismiss is a trap on a touch screen.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("acct.menu")}
        onClick={() => {
          setOpenedOn(pathname);
          setOpen((value) => !value);
        }}
        className={cn(
          // Just the avatar on a phone — the name is hidden there, so padding
          // for it made the pill wider than the face inside it.
          "soft-press flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-surface-2 sm:py-1 sm:pr-2.5 sm:pl-1",
          open && "bg-surface-2",
        )}
      >
        <Avatar name={name} src={avatarUrl} size="sm" />
        <span className="hidden max-w-28 truncate text-sm font-medium sm:block">{name}</span>
        <ChevronDown
          className={cn("hidden size-3.5 text-text-light transition-transform sm:block", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-border p-4">
            <Avatar name={name} src={avatarUrl} size="md" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">
                <span>{name}</span>
              </p>
              {subtitle && (
                <p className="mt-0.5 truncate text-xs font-medium text-primary">
                  <span>{subtitle}</span>
                </p>
              )}
              <p className="mt-1 truncate text-xs text-text-light">
                <span>{email}</span>
              </p>
              {phone && (
                <p className="tnum mt-0.5 truncate text-xs text-text-light">
                  <span>{phone}</span>
                </p>
              )}
            </div>
          </div>

          <ul
            className="p-1.5"
            onClick={(e) => {
              // Any link closes the panel — including one to the page you are
              // already on, which no pathname change can report.
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2",
                      active ? "text-primary" : "text-text-secondary hover:text-text",
                    )}
                  >
                    <NavIcon name={link.icon} className="size-4 shrink-0" />
                    <span>{t(link.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-border p-1.5">
            <LogoutButton variant="full" className="px-3 py-2.5" />
          </div>
        </div>
      )}
    </div>
  );
}
