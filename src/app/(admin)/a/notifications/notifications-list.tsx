"use client";

import { useTransition } from "react";
import { AlertTriangle, Bell, Check, CheckCheck, Info, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, isoAttr } from "@/lib/format/datetime";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/data/platform-actions";
import type { NotificationRow } from "@/lib/data/platform";
import { cn } from "@/lib/utils";

const ICONS = { info: Info, success: Check, warning: AlertTriangle, error: XCircle } as const;

const TONE: Record<NotificationRow["tone"], string> = {
  info: "bg-info-light text-info",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  error: "bg-error-light text-error",
};

export function NotificationsList({ notifications }: { notifications: NotificationRow[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const unread = notifications.filter((n) => !n.readAt).length;

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast(success, "success");
      else toast(result.error ?? "Something went wrong.", "error");
    });
  }

  return (
    <>
      {unread > 0 && (
        <div className="mb-5 flex justify-end">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => act(markAllNotificationsRead, "All marked as read.")}
          >
            <CheckCheck className="size-4" aria-hidden />
            <span>Mark all as read</span>
          </Button>
        </div>
      )}

      <div className="max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
        {notifications.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title="No notifications"
            description="Platform events addressed to you appear here — broadcasts, approvals awaiting review, and billing alerts."
          />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((n) => {
              const Icon = ICONS[n.tone];
              return (
                <li
                  key={n.id}
                  className={cn("flex items-start gap-4 p-5", !n.readAt && "bg-primary-light/40")}
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full",
                      TONE[n.tone],
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {n.title}
                      {!n.readAt && (
                        <span
                          className="ml-2 inline-block size-2 rounded-full bg-primary align-middle"
                          aria-label="Unread"
                        />
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-text-secondary">{n.body}</p>
                    <time
                      dateTime={isoAttr(n.createdAt)}
                      className="tnum mt-1 block text-xs text-text-light"
                    >
                      {formatDateTime(n.createdAt)}
                    </time>
                  </div>

                  {!n.readAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => act(() => markNotificationRead(n.id), "Marked as read.")}
                    >
                      Mark read
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
