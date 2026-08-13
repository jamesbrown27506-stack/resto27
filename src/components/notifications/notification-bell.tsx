"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Bell, BellOff, Check, CheckCheck, Info, XCircle } from "lucide-react";
import { useNotifications } from "./notification-provider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { formatDateTime } from "@/lib/format/datetime";
import {
  listRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type RecentNotification,
} from "@/lib/data/notify-actions";
import type { NotifyTone } from "@/lib/notify";
import { cn } from "@/lib/utils";

const ICONS: Record<NotifyTone, typeof Info> = {
  info: Info,
  success: Check,
  warning: AlertTriangle,
  error: XCircle,
};

const TONE: Record<NotifyTone, string> = {
  info: "bg-info-light text-info",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  error: "bg-error-light text-error",
};

/**
 * The bell: an unread badge on an icon, opening a dropdown of the most
 * recent notifications. Lives in the manager top bar, the admin top bar and
 * the customer header — the same component, three shells.
 *
 * Tap-to-open deep-links through the row's `href`, exactly like the admin
 * notifications page. Marking read is a server action scoped to the session,
 * so the badge can never be decremented by touching someone else's row.
 */
export function NotificationBell() {
  const { unread, decrementUnread, clearUnread } = useNotifications();
  const { toast } = useToast();
  const { t } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentNotification[] | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click — a dropdown that follows focus is otherwise
  // impossible to dismiss on a touch screen.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) {
      void listRecentNotifications().then(setItems).catch(() => {});
    }
  }

  function readOne(id: string) {
    decrementUnread();
    startTransition(async () => {
      await markNotificationRead(id);
    });
  }

  function readAll() {
    clearUnread();
    setItems((current) => current?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) toast(result.error ?? "Something went wrong.", "error");
    });
  }

  function onItemClick(n: RecentNotification) {
    if (!n.readAt) readOne(n.id);
    setOpen(false);
    if (n.href) router.push(n.href);
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={unread > 0 ? t("notif.unreadCount", { count: unread }) : t("notif.title")}
        aria-expanded={open}
        onClick={toggle}
        className="relative"
      >
        {unread > 0 ? <Bell className="size-4.5" aria-hidden /> : <BellOff className="size-4.5" aria-hidden />}
        {unread > 0 && (
          <span className="tnum absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-fg">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          // The bottom offset clears the mobile tab bar (min-h-16 plus the
          // phone's gesture inset) instead of overlaying it — the tab bar is
          // how you leave this screen, and covering it while a panel is open
          // is the one moment you most want it.
          style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
          className={cn(
            "fixed inset-x-2 z-50 overflow-hidden rounded-lg border border-border bg-surface shadow-xl",
            // Desktop: the anchored dropdown under the bell, as before. Mobile:
            // a full-width bottom sheet — a narrow right-aligned dropdown on a
            // phone is exactly what gets clipped and unreadable, so it becomes
            // a sheet that is never off-screen, clear of the tab bar.
            //
            // `lg:bottom-auto!` beats the inline style above, which no class
            // could otherwise override.
            "lg:absolute lg:inset-x-auto lg:right-0 lg:top-full lg:bottom-auto! lg:mt-2 lg:w-88 lg:max-w-[calc(100vw-2rem)]",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">
              <span>{t("notif.title")}</span>
              {unread > 0 && (
                <span className="tnum ml-2 text-xs font-normal text-text-light">
                  {t("notif.unreadCount", { count: unread })}
                </span>
              )}
            </p>
            {unread > 0 && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={readAll}>
                <CheckCheck className="size-3.5" aria-hidden />
                <span>{t("notif.markAllRead")}</span>
              </Button>
            )}
          </div>

          {items === null ? (
            <div className="px-4 py-8 text-center text-sm text-text-light">
              <span>{t("common.loading")}</span>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Bell />}
              title={t("notif.empty")}
              description={t("notif.emptyBody")}
            />
          ) : (
            <ul className="max-h-[60dvh] overflow-y-auto divide-y divide-border lg:max-h-[22rem]">
              {items.map((n) => {
                const Icon = ICONS[n.tone];
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onItemClick(n)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2",
                        !n.readAt && "bg-primary-light/30",
                      )}
                    >
                      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", TONE[n.tone])}>
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{n.title}</span>
                          {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                        </span>
                        {n.body && <span className="mt-0.5 block text-xs text-text-secondary">{n.body}</span>}
                        <time className="tnum mt-1 block text-[10px] text-text-light">
                          {formatDateTime(n.createdAt)}
                        </time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

        </div>
      )}
    </div>
  );
}
