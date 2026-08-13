"use client";

import { useState, useTransition } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  Megaphone,
  Send,
  ShoppingBag,
  Star,
  UserCog,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBody } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { sendTestNotification, type NotifyTestChannels, type NotifyTestKey } from "@/lib/data/notify-test-actions";
import { cn } from "@/lib/utils";

interface TestButton {
  key: NotifyTestKey;
  label: string;
  description: string;
}

const GROUPS: { value: string; label: string; icon: React.ReactNode; tests: TestButton[] }[] = [
  {
    value: "orders",
    label: "Orders",
    icon: <ShoppingBag aria-hidden />,
    tests: [
      { key: "new_order", label: "New order", description: "Customer placed an order — the branch staff's view." },
      { key: "order_status", label: "Order confirmed", description: "An order advanced a step — the customer's view, with the quoted delivery fee." },
      { key: "cancelled_by_customer", label: "Cancelled by customer", description: "The manager learns a customer pulled an order." },
      { key: "cancelled_by_restaurant", label: "Cancelled by restaurant", description: "The customer learns their order was cancelled, with the reason." },
      { key: "low_stock", label: "Low stock", description: "A tracked dish crossed its threshold — points the manager at the menu." },
      { key: "loyalty", label: "Loyalty points", description: "Points credited to a customer on delivery." },
    ],
  },
  {
    value: "reservations",
    label: "Reservations",
    icon: <CalendarCheck aria-hidden />,
    tests: [
      { key: "reservation", label: "New reservation", description: "A guest requested a table — the branch staff's view." },
      { key: "reservation_confirmed", label: "Reservation confirmed", description: "The guest is told their table is booked." },
      { key: "reservation_declined", label: "Reservation declined", description: "The guest is told it was refused, with the reason." },
    ],
  },
  {
    value: "reviews",
    label: "Reviews",
    icon: <Star aria-hidden />,
    tests: [
      { key: "review", label: "New review", description: "A customer rated the restaurant — the manager's view." },
      { key: "review_reply", label: "Reply to review", description: "The restaurant answered — the customer's view." },
      { key: "moderation", label: "Review reported", description: "A restaurant reported a review — the moderators' view." },
    ],
  },
  {
    value: "billing",
    label: "Billing",
    icon: <CreditCard aria-hidden />,
    tests: [
      { key: "billing", label: "Billing update", description: "A plan change or account notice — the manager's view." },
      { key: "billing_paid", label: "Payment received", description: "An invoice was settled — the manager's view." },
      { key: "billing_refund", label: "Refund issued", description: "Money returned — the manager's view." },
      { key: "new_subscription", label: "New subscription", description: "A tenant chose a plan — the admins' view." },
    ],
  },
  {
    value: "account",
    label: "Account",
    icon: <UserCog aria-hidden />,
    tests: [
      { key: "approval", label: "Restaurant approved", description: "The owner learns their restaurant is live." },
      { key: "suspension", label: "Restaurant suspended", description: "The owner learns their restaurant was suspended." },
      { key: "account", label: "Account reinstated", description: "A user learns their account is active again." },
    ],
  },
  {
    value: "platform",
    label: "Platform",
    icon: <Megaphone aria-hidden />,
    tests: [
      { key: "broadcast", label: "Broadcast", description: "A platform-wide message — copy passes through untouched." },
      { key: "support", label: "Support message", description: "A contact-form message arrived — the admins' view." },
    ],
  },
];

/** Every channel on — the tester's starting point. A "use server" file
    cannot export this value, so it lives here in the client. */
const NOTIFY_TEST_CHANNELS_DEFAULT: NotifyTestChannels = {
  bell: true,
  realtime: true,
  email: true,
  push: true,
};

/** Which channel each chip toggles, and what it exercises. */
const CHANNELS: { key: keyof NotifyTestChannels; label: string; hint: string }[] = [
  {
    key: "bell",
    label: "Bell",
    hint: "Writes the in-app row — the bell badge and its list.",
  },
  {
    key: "realtime",
    label: "Realtime",
    hint: "The same row arriving live: toast + sound while this tab is open.",
  },
  {
    key: "email",
    label: "Email",
    hint: "Delivers by email when SMTP is configured.",
  },
  {
    key: "push",
    label: "Web push",
    hint: "Native browser notification — needs a subscribed device over HTTPS.",
  },
];

/**
 * Diagnostics → Notifications.
 *
 * One button per event type. Each sends a real notification through the same
 * writer production uses (lib/notify.ts), addressed to the signed-in admin —
 * but only through the channels picked above. Bell and Realtime are the same
 * in-app row; Realtime is it arriving live. Real recipients are never touched.
 */
export function NotificationTester() {
  const [active, setActive] = useState(GROUPS[0].value);
  const [channels, setChannels] = useState<NotifyTestChannels>(NOTIFY_TEST_CHANNELS_DEFAULT);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function run(key: NotifyTestKey) {
    setResult(null);
    startTransition(async () => setResult(await sendTestNotification(key, channels)));
  }

  function toggleChannel(key: keyof NotifyTestChannels) {
    setResult(null);
    setChannels((c) => ({ ...c, [key]: !c[key] }));
  }

  return (
    <CardBody className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-text-secondary">
        Each button delivers a <strong className="text-text">real notification</strong> to your own
        bell — the same copy, tone, deep link and preference gating a live event produces — but
        only through the channels ticked below. Nothing reaches a real customer.
      </p>

      {/* ── Which channels to exercise ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Channels to test">
        <span className="mr-1 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
          Deliver via
        </span>
        {CHANNELS.map((ch) => {
          const on = channels[ch.key];
          return (
            <button
              key={ch.key}
              type="button"
              aria-pressed={on}
              title={ch.hint}
              onClick={() => toggleChannel(ch.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                on
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border bg-surface-2 text-text-light hover:text-text",
              )}
            >
              {ch.label}
            </button>
          );
        })}
      </div>

      <Tabs
        items={GROUPS.map((g) => ({ value: g.value, label: g.label, icon: g.icon }))}
        value={active}
        onChange={setActive}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {GROUPS.find((g) => g.value === active)!.tests.map((test) => (
          <button
            key={test.key}
            type="button"
            disabled={pending}
            onClick={() => run(test.key)}
            className="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-light/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Send className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{test.label}</span>
              <span className="mt-0.5 block text-xs text-text-secondary">{test.description}</span>
            </span>
          </button>
        ))}
      </div>

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
  );
}
