"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useIsSuperAdmin } from "@/components/layout/admin-shell";
import { getActivityCounts, resetPlatformActivity } from "@/lib/data/platform-reset-actions";

const LABELS: Record<string, string> = {
  orders: "Orders",
  payment_attempts: "Payment attempts",
  refunds: "Refunds",
  invoices: "Invoices",
  notifications: "Notifications",
  conversation_messages: "Chat messages",
  reservations: "Reservations",
  reviews: "Reviews",
  withdrawal_requests: "Withdrawals",
  loyalty_ledger: "Loyalty entries",
  dining_sessions: "Table sessions",
  support_messages: "Support messages",
};

/**
 * Danger zone — "reset the platform to new" after testing (0067).
 * Super admins only (hidden for simple admins; the action refuses too).
 * Two steps: see what will be deleted, then type RESET.
 */
export function ResetPanel() {
  const isSuper = useIsSuperAdmin();
  const { toast } = useToast();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  if (!isSuper) return null;

  return (
    <section className="mt-10 rounded-xl border-2 border-error/40 bg-error-light/40 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-error">
        <AlertTriangle className="size-4" aria-hidden /> Danger zone — reset test data
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Deletes every order, payment, refund, invoice, notification, chat, reservation, review, loyalty entry, wallet
        movement, withdrawal and table session. <strong>Keeps</strong> all users, restaurants, staff, menus, tables,
        opening hours, settings, plans and subscriptions. Wallet balances and ratings go back to zero. This cannot be
        undone — take a Supabase backup first.
      </p>

      {!counts ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={pending}
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await getActivityCounts();
              if (!result.ok) return toast(result.error, "error");
              setCounts(result.counts);
            })
          }
        >
          See what would be deleted
        </Button>
      ) : (
        <div className="mt-4 space-y-4">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {Object.entries(counts).map(([table, count]) => (
              <li key={table} className="flex justify-between gap-3 rounded bg-surface px-3 py-1.5">
                <span>{LABELS[table] ?? table}</span>
                <span className="tnum font-semibold">{count}</span>
              </li>
            ))}
          </ul>
          <Field label='Type RESET to confirm' htmlFor="reset-confirm">
            <Input id="reset-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
          <Button
            variant="danger"
            disabled={typed !== "RESET" || pending}
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await resetPlatformActivity(typed);
                if (!result.ok) return toast(result.error, "error");
                toast(result.note, "success");
                setCounts(null);
                setTyped("");
              })
            }
          >
            Delete all test activity
          </Button>
        </div>
      )}
    </section>
  );
}
