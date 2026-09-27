"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bell, Check, ChefHat, Clock3, Copy, CreditCard, Droplets, HandPlatter, Minus, Plus, ReceiptText, Send,
  ShoppingBag, Star, Trash2, User, Users, UtensilsCrossed, WalletCards, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Radio, Textarea } from "@/components/ui/input";
import { ModifierSheet } from "@/components/menu/modifier-sheet";
import type { MenuItem } from "@/lib/data/manager";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PaymentPendingView } from "@/components/payment/payment-pending";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import {
  openTableBill, joinTableBill, getGuestDiningState, submitGuestRound, sendGuestDiningMessage,
  startGuestPayment, checkGuestPayment, withdrawTableAccess, submitVisitReview,
} from "@/lib/data/dining-actions";
import { nativePlatform } from "@/lib/capacitor/platform";
import { syncGuestPush } from "@/lib/dining/guest-push-client";
import { playNotificationSound, unlockNotificationSound } from "@/lib/notifications/sound-player";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";
import { MIN_PART_PAYMENT, TIP_PERCENTS, isJoinCode, quotePayment, shareFor, tipFromPercent, type SplitMode } from "@/lib/dining/bill";
import { cn } from "@/lib/utils";

type Landing = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/dining-actions").getTableLanding>>>;
type State = NonNullable<Awaited<ReturnType<typeof getGuestDiningState>>>;
/**
 * One basket line. `key` is dish + chosen options + note, so "Poulet DG,
 * sans piment" and "Poulet DG" stay two lines exactly as in the delivery
 * basket (cart-provider's optionsHash).
 */
type Line = {
  key: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  optionIds: string[];
  optionsLabel: string;
  notes: string | null;
};

/*
  ─────────────────────────────────────────────────────────────────────────
   THE TABLE PAGE, SINCE 0068: ONE BILL PER PARTY, ORDER FIRST.

   Scanning offers "Seul" or "Avec d'autres". A group bill shows its
   4-character code; friends scan the same table, choose "Rejoindre" and
   type it. Nobody waits for a waiter to see the menu or send dishes: the
   dishes simply stay "waiting for your presence to be confirmed" until the
   waiter has seen the party, then go to the kitchen like any other.

   Paying online lets each person pay everything that is left, only their
   dishes, an equal share, or an amount — with an optional tip when the
   restaurant accepts them. Paying at the table is the waiter's business:
   the page just calls him with the bill.

   POLLING: FAST ONLY WHILE SOMETHING IS ABOUT TO CHANGE. 5 s while
   something is pending (presence, a dish, a payment), 25 s otherwise,
   nothing while the tab is hidden, nothing once the visit is over. Push
   wakes the page for every staff decision; polling is the fallback.
  ─────────────────────────────────────────────────────────────────────────
*/
const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 25_000;

function lineKey(menuItemId: string, optionIds: string[], notes: string | null): string {
  return `${menuItemId}::${[...optionIds].sort().join("|")}::${notes ?? ""}`;
}

function GuestDishPhoto({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2">
    {src && !failed
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
      : <UtensilsCrossed className="size-7 text-text-light" />}
  </div>;
}

function StarPicker({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}/5`}
          onClick={() => onChange(n)} className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
          <Star className={cn("size-7", n <= value ? "fill-warning text-warning" : "text-text-light")} aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function GuestTableClient({ landing }: { landing: Landing }) {
  const { locale, t } = useLocale();
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const pollMs = useRef(FAST_POLL_MS);
  const pollStopped = useRef(false);
  // Restarts the wait so a switch from slow to fast takes effect at once.
  const pollRestart = useRef<(() => void) | null>(null);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinMode, setJoinMode] = useState<"choose" | "code">("choose");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [attempt, setAttempt] = useState<string | null>(null);
  const [attemptTotal, setAttemptTotal] = useState(0);
  const [instruction, setInstruction] = useState<PaymentInstruction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [mode, setMode] = useState<SplitMode>("all");
  const [parts, setParts] = useState(2);
  const [customAmount, setCustomAmount] = useState("");
  const [tipChoice, setTipChoice] = useState<"none" | "5" | "10" | "custom">("none");
  const [customTip, setCustomTip] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(landing.categories[0]?.id ?? "");
  const [pushStatus, setPushStatus] = useState<"idle" | "enabled" | "unavailable">("idle");
  const [rating, setRating] = useState(0);
  const [reviewBody, setReviewBody] = useState("");
  const [platformRating, setPlatformRating] = useState(0);
  const [platformBody, setPlatformBody] = useState("");
  const [reviewSent, setReviewSent] = useState(false);
  const seenMessages = useRef<Set<string> | null>(null);
  const lastNativePushAt = useRef(0);
  const storageKey = `resto237-table-${landing.table.token}`;

  useEffect(() => {
    const unlock = () => unlockNotificationSound();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      const result = await syncGuestPush(token, false);
      syncing = false;
      if (alive) setPushStatus(result);
    };
    const resume = () => { if (document.visibilityState === "visible") void sync(); };
    void sync();
    window.addEventListener("resto237:resume", resume);
    window.addEventListener("resto237:native-token", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false;
      window.removeEventListener("resto237:resume", resume);
      window.removeEventListener("resto237:native-token", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => setToken(localStorage.getItem(storageKey)), 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      return getGuestDiningState(token).then((next) => {
        if (!alive) return;
        if (!next) {
          setError(t("ons.g.visitGone"));
          setState(null);
          return;
        }
        const ids = new Set(next.messages.map((entry) => entry.id));
        if (seenMessages.current) {
          const fresh = next.messages.filter((entry) =>
            !seenMessages.current?.has(entry.id) && entry.sender_kind !== "guest");
          if (fresh.length) {
            setNotice(fresh[fresh.length - 1].body);
            // Background push uses the OS sound; the open table page supplies its own.
            if (document.visibilityState === "visible" &&
                (nativePlatform() !== "ios" || Date.now() - lastNativePushAt.current > 10_000)) void playNotificationSound();
          }
        }
        seenMessages.current = ids;
        setState(next);
      }).catch(() => {
        if (alive) setError(t("ons.g.connectionLost"));
      });
    };
    void refresh();
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (!alive) return;
        if (!pollStopped.current) await refresh();
        if (alive) schedule();
      }, pollMs.current);
    };
    schedule();
    pollRestart.current = () => {
      window.clearTimeout(timer);
      if (alive) schedule();
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const onPush = (event: Event) => {
      const data = event instanceof MessageEvent ? event.data : (event as CustomEvent).detail;
      if (data?.type === "restolink:notification" && data.href === `/table/${landing.table.token}`) {
        if (!(event instanceof MessageEvent)) lastNativePushAt.current = Date.now();
        void refresh();
      }
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", onPush);
    window.addEventListener("resto237:native-notification", onPush);
    return () => {
      alive = false;
      pollRestart.current = null;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", onPush);
      window.removeEventListener("resto237:native-notification", onPush);
    };
  }, [token, t, landing.table.token]);

  useEffect(() => {
    if (!token || !attempt) return;
    const timer = window.setInterval(() => void checkGuestPayment(token, attempt).then((result) => {
      if (result.instruction) setInstruction(result.instruction);
      if (result.status === "succeeded") {
        setAttempt(null);
        setPayOpen(false);
        setNotice(t("ons.g.paid"));
        void getGuestDiningState(token).then((next) => next && setState(next));
      } else if (result.status === "failed") {
        setAttempt(null);
        setError(t("ons.g.payNotConfirmed"));
      }
    }), 5000);
    return () => window.clearInterval(timer);
  }, [token, attempt, t]);

  const groups = useMemo(() => landing.categories
    .map((category) => ({ category, items: landing.items.filter((item) => item.category_id === category.id) }))
    .filter((group) => group.items.length > 0), [landing]);
  const currentGroup = groups.find((group) => group.category.id === selectedCategory) ?? groups[0];
  const cartTotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);

  type RoundRow = State["rounds"][number];
  const myRounds: RoundRow[] = state ? state.rounds.filter((round) => round.guest_id === state.guest.id) : [];
  const hasPendingDishes = state?.rounds.some((round) =>
    round.dining_round_items.some((item) => item.status === "pending")) ?? false;
  const paymentInFlight = (state?.bill.inFlight ?? 0) > 0;

  const visitOver = Boolean(state && (
    state.session.status === "closed" || state.session.status === "cancelled" ||
    state.guest.status === "rejected"));
  const somethingPending = !state || state.guest.status === "pending" || hasPendingDishes ||
    Boolean(attempt) || paymentInFlight;
  useEffect(() => {
    pollStopped.current = visitOver;
    const next = somethingPending ? FAST_POLL_MS : SLOW_POLL_MS;
    const sooner = next < pollMs.current;
    pollMs.current = next;
    if (sooner) pollRestart.current?.();
  }, [visitOver, somethingPending]);

  /** The same shape the delivery menu uses, so the ModifierSheet can be reused as is. */
  const menuItems = useMemo(() => new Map<string, MenuItem>(landing.items.map((item) => [item.id, {
    id: item.id,
    restaurantId: "",
    categoryId: item.category_id ?? null,
    name: item.name,
    description: item.description ?? "",
    price: Number(item.price),
    imageUrl: item.image_url ?? null,
    isAvailable: Boolean(item.is_available),
    isFeatured: false,
    prepMinutes: 0,
    trackStock: Boolean(item.track_stock),
    stockQuantity: item.stock_quantity ?? null,
    lowStockThreshold: null,
    dietaryTags: "",
    allergens: "",
    sortOrder: item.sort_order ?? 0,
    optionGroups: landing.groups
      .filter((group) => group.menu_item_id === item.id)
      .map((group) => ({
        id: group.id,
        menuItemId: group.menu_item_id,
        name: group.name,
        minSelect: Number(group.min_select) || 0,
        maxSelect: Math.max(1, Number(group.max_select) || 1),
        isRequired: Boolean(group.is_required),
        sortOrder: group.sort_order ?? 0,
        options: landing.options
          .filter((option) => option.group_id === group.id)
          .map((option) => ({
            id: option.id,
            groupId: option.group_id,
            name: option.name,
            priceDelta: Number(option.price_delta) || 0,
            isAvailable: Boolean(option.is_available),
            sortOrder: option.sort_order ?? 0,
          })),
      })),
  }])), [landing]);

  function resetVisit() {
    localStorage.removeItem(storageKey);
    setToken(null);
    setState(null);
    setError(null);
    setNotice(null);
    setPushStatus("idle");
    setJoinMode("choose");
    setReviewSent(false);
    seenMessages.current = null;
  }

  function adopt(guestToken: string) {
    localStorage.setItem(storageKey, guestToken);
    setToken(guestToken);
    start(async () => {
      const next = await getGuestDiningState(guestToken);
      if (next) setState(next);
    });
  }

  function open(kind: "solo" | "group") {
    start(async () => {
      setError(null);
      const result = await openTableBill(landing.table.token, name, kind, locale);
      if (!result.ok || !result.guestToken) {
        setError(result.error ?? t("ons.g.joinFailed"));
        return;
      }
      adopt(result.guestToken);
    });
  }

  function joinWithCode() {
    start(async () => {
      setError(null);
      const result = await joinTableBill(landing.table.token, joinCode, name, locale);
      if (!result.ok || !result.guestToken) {
        setError(result.error ?? t("ons.g.joinFailed"));
        return;
      }
      adopt(result.guestToken);
      setNotice(result.status === "approved" ? t("ons.g.joinedConfirmed") : t("ons.g.joinedPending"));
    });
  }

  function withdraw() {
    if (!token) return;
    start(async () => {
      const result = await withdrawTableAccess(token);
      if (!result.ok) {
        setError(result.error ?? t("tbg.err.cancelFailed"));
        const next = await getGuestDiningState(token);
        if (next) setState(next);
        return;
      }
      resetVisit();
      setNotice(t("tbg.cancelled"));
    });
  }

  async function enableAlerts(raw: string) {
    unlockNotificationSound();
    const result = await syncGuestPush(raw, true);
    setPushStatus(result);
    if (result === "enabled") {
      setNotice(t("ons.g.alertsOn"));
      void playNotificationSound();
    }
  }

  function addLine(line: Omit<Line, "key">) {
    const key = lineKey(line.menuItemId, line.optionIds, line.notes);
    setCart((current) => {
      const old = current.find((entry) => entry.key === key);
      return old
        ? current.map((entry) => entry.key === key ? { ...entry, quantity: Math.min(50, entry.quantity + line.quantity) } : entry)
        : [...current, { ...line, key }];
    });
    setCartOpen(true);
  }

  function add(item: Landing["items"][number]) {
    const menuItem = menuItems.get(item.id);
    if (menuItem && menuItem.optionGroups.length > 0) {
      setSheetItem(menuItem);
      return;
    }
    addLine({ menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1, optionIds: [], optionsLabel: "", notes: null });
  }

  function changeQuantity(key: string, delta: number) {
    setCart((current) => current.map((line) => line.key === key ? { ...line, quantity: Math.min(50, line.quantity + delta) } : line).filter((line) => line.quantity > 0));
  }

  function submit() {
    if (!token) return;
    start(async () => {
      setError(null);
      /*
        A round carries ONE note (dining_round_items has no notes column), so
        per-dish notes are folded into it, each prefixed with its dish.
      */
      const dishNotes = cart
        .filter((line) => line.notes)
        .map((line) => `${line.quantity}× ${line.name}${line.optionsLabel ? ` (${line.optionsLabel})` : ""} : ${line.notes}`);
      const roundNote = [...dishNotes, notes.trim()].filter(Boolean).join(" ; ").slice(0, 500);
      const result = await submitGuestRound(token, {
        lines: cart.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity, optionIds: line.optionIds })),
        notes: roundNote,
      });
      if (!result.ok) { setError(result.error ?? t("tbg.err.roundFailed")); return; }
      setCart([]);
      setNotes("");
      setCartOpen(false);
      setNotice(state?.guest.status === "pending" ? t("ons.g.sentWaitingPresence") : t("ons.g.sentForReview"));
      const next = await getGuestDiningState(token);
      if (next) setState(next);
    });
  }

  function quick(kind: "call_waiter" | "water" | "cutlery" | "bill" | "help" | "message", body?: string) {
    if (!token) return;
    start(async () => {
      const result = await sendGuestDiningMessage(token, kind, body);
      if (!result.ok) { setError(result.error ?? t("tbg.err.messageFailed")); return; }
      setMessage("");
      setNotice(t("ons.g.notified"));
      const next = await getGuestDiningState(token);
      if (next) setState(next);
    });
  }

  /* ── Payment preview (the server recomputes the real figure) ─────────── */
  const bill = state?.bill ?? { due: 0, paid: 0, inFlight: 0, remaining: 0, mine: 0 };
  const share = shareFor({
    mode,
    due: bill.due,
    remaining: bill.remaining,
    mine: bill.mine,
    parts,
    amount: Number(customAmount) || 0,
  });
  const shareAmount = share.ok ? share.share : 0;
  const tip = !landing.tipsEnabled || tipChoice === "none"
    ? 0
    : tipChoice === "custom"
      ? Math.max(0, Math.round(Number(customTip) || 0))
      : tipFromPercent(shareAmount, Number(tipChoice));
  const quote = quotePayment(shareAmount, tip, landing.serviceChargePercent);

  function pay() {
    if (!token || !share.ok) return;
    start(async () => {
      setError(null);
      const result = await startGuestPayment(token, {
        mode, amount: Number(customAmount) || 0, parts, tip: quote.tip, phone,
      });
      if (!result.ok) { setError(result.error ?? t("tbg.err.paymentFailed")); return; }
      if (result.status === "pending" && result.attemptId) {
        setAttempt(result.attemptId);
        setAttemptTotal(result.total ?? quote.total);
        setInstruction(result.instruction ?? null);
      } else {
        setPayOpen(false);
        setNotice(t("ons.g.paid"));
        const next = await getGuestDiningState(token);
        if (next) setState(next);
      }
    });
  }

  function sendReview() {
    if (!token || rating < 1) return;
    start(async () => {
      const result = await submitVisitReview(token, {
        rating, body: reviewBody, platformRating: platformRating || null, platformBody,
      });
      if (!result.ok) { setError(result.error ?? t("ons.err.reviewFailed")); return; }
      setReviewSent(true);
      setNotice(t("ons.g.reviewThanks"));
    });
  }

  const alertsControl = token && (pushStatus === "enabled" ? (
    <span className="flex items-center gap-2 text-sm text-success"><Bell className="size-4" />{t("ons.g.alertsEnabled")}</span>
  ) : (
    <Button variant="outline" size="sm" onClick={() => void enableAlerts(token)}>
      <Bell className="size-4" />
      {t("ons.g.enableAlerts")}
    </Button>
  ));

  const noticeToast = notice && (
    <div role="status" className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-lg border border-primary/30 bg-surface p-4 shadow-lg">
      <Bell className="mt-0.5 size-5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">{notice}</p>
      <button type="button" className="rounded-full p-1" aria-label={t("ons.g.dismiss")} onClick={() => setNotice(null)}><X className="size-4" /></button>
    </div>
  );
  const errorToast = error && (
    <div role="alert" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-lg items-start gap-2 rounded-md bg-error px-4 py-3 text-sm text-white">
      <p className="min-w-0 flex-1">{error}</p><button type="button" aria-label={t("ons.g.dismiss")} onClick={() => setError(null)}><X className="size-4" /></button>
    </div>
  );

  /* ── 1. Nobody yet: alone, a new group, or join a group ─────────────── */
  if (!token) return (
    <main className="mx-auto min-h-[100dvh] max-w-lg px-4 py-10">
      {noticeToast}
      <p className="text-sm font-semibold text-primary">{landing.restaurant?.name}</p>
      <h1 className="mt-2 font-display text-3xl font-bold">{t("ons.g.welcome", { table: landing.table.number })}</h1>
      <p className="mt-3 text-text-secondary">{t("ons.g.welcomeBody")}</p>
      <div className="mt-8 rounded-lg border border-border bg-surface p-5">
        <Field label={t("ons.g.yourName")} htmlFor="guest-name" hint={t("ons.g.yourNameHint")}>
          <Input id="guest-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={t("ons.g.yourNamePh")} />
        </Field>

        {joinMode === "choose" ? (
          <div className="mt-5 grid gap-3">
            <Button fullWidth size="lg" variant="outline" disabled={pending || name.trim().length < 2} loading={pending} onClick={() => open("solo")}
              className="h-auto justify-start whitespace-normal py-3 text-left">
              <User className="size-5 shrink-0" />
              <span><span className="block font-semibold">{t("ons.g.solo")}</span><span className="block text-xs font-normal text-text-secondary">{t("ons.g.soloBody")}</span></span>
            </Button>
            <Button fullWidth size="lg" variant="outline" disabled={pending || name.trim().length < 2} onClick={() => open("group")}
              className="h-auto justify-start whitespace-normal py-3 text-left">
              <Users className="size-5 shrink-0" />
              <span><span className="block font-semibold">{t("ons.g.group")}</span><span className="block text-xs font-normal text-text-secondary">{t("ons.g.groupBody")}</span></span>
            </Button>
            <button type="button" onClick={() => { setJoinMode("code"); setError(null); }} className="mt-1 text-sm font-semibold text-primary hover:underline">
              {t("ons.g.haveCode")}
            </button>
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            <Field label={t("ons.g.codeLabel")} htmlFor="join-code" hint={t("ons.g.codeHint")}>
              <Input id="join-code" value={joinCode} maxLength={4} autoCapitalize="characters" autoComplete="off"
                className="tnum text-center text-2xl font-bold tracking-[0.4em] uppercase"
                onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="4K7Q" />
            </Field>
            <Button fullWidth size="lg" disabled={pending || name.trim().length < 2 || !isJoinCode(joinCode)} loading={pending} onClick={joinWithCode}>
              <Users className="size-4" />{t("ons.g.join")}
            </Button>
            <button type="button" onClick={() => setJoinMode("choose")} className="text-sm text-text-secondary hover:underline">{t("ons.g.back")}</button>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
      </div>
    </main>
  );

  if (!state && error) return (
    <main className="mx-auto grid min-h-[100dvh] max-w-lg place-items-center px-4 text-center">
      <div><p className="text-text-secondary">{error}</p><Button className="mt-4" onClick={resetVisit}>{t("ons.g.startAgain")}</Button></div>
    </main>
  );

  if (!state) return (
    <main className="mx-auto grid min-h-[100dvh] max-w-lg place-items-center px-4">
      <Clock3 className="size-10 animate-pulse text-primary" aria-label={t("ons.g.loading")} />
    </main>
  );

  const guestName = (id: string | null) => id
    ? state.guests.find((guest) => guest.id === id)?.display_name ?? t("ons.g.guest")
    : t("ons.g.waiter");
  const orderStatus = state.order?.status ?? null;
  const kitchenLabel = orderStatus === "preparing" ? t("ons.g.kitchenPreparing")
    : orderStatus === "shipped" ? t("ons.g.kitchenServed")
      : t("ons.g.kitchenQueued");

  /* ── 2. Refused, or the bill was closed empty ────────────────────────── */
  if (state.guest.status === "rejected" || state.session.status === "cancelled") return (
    <main className="mx-auto grid min-h-[100dvh] max-w-lg place-items-center px-4 text-center">
      <div>
        <X className="mx-auto size-10 text-error" />
        <h1 className="mt-4 text-2xl font-bold">{state.guest.status === "rejected" ? t("ons.g.refused") : t("ons.g.billClosedEmpty")}</h1>
        <p className="mt-2 text-text-secondary">{t("ons.g.refusedBody")}</p>
        <Button className="mt-4" onClick={resetVisit}>{t("ons.g.startAgain")}</Button>
      </div>
    </main>
  );

  /* ── 3. Visit over: the receipt, and the review ──────────────────────── */
  if (state.session.status === "closed") {
    const order = state.order;
    return (
      <main className="mx-auto min-h-[100dvh] max-w-lg px-4 py-8">
        {noticeToast}{errorToast}
        <div className="text-center">
          <Check className="mx-auto size-10 text-success" />
          <h1 className="mt-3 font-display text-2xl font-bold">{t("ons.g.thanks")}</h1>
          <p className="mt-1 text-sm text-text-secondary">{landing.restaurant?.name} · {t("ons.g.table", { number: landing.table.number })}</p>
        </div>

        {order && (
          <section className="mt-6 rounded-lg border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold"><ReceiptText className="size-4" />{t("ons.g.receipt")} · {order.reference}</h2>
            <ul className="mt-3 divide-y divide-border text-sm">
              {(order.order_items ?? []).map((item, index) => (
                <li key={index} className="flex justify-between gap-3 py-1.5">
                  <span className="min-w-0 break-words">{item.quantity}× {item.name}{item.options_label ? ` · ${item.options_label}` : ""}</span>
                  <span className="tnum shrink-0">{formatMoney(item.unit_price * item.quantity)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between"><dt>{t("ons.g.food")}</dt><dd className="tnum">{formatMoney(Number(order.subtotal ?? 0))}</dd></div>
              {state.session.depositCredit > 0 && <div className="flex justify-between text-success"><dt>{t("ons.g.depositDeducted")}</dt><dd className="tnum">−{formatMoney(Math.min(state.session.depositCredit, Number(order.subtotal ?? 0)))}</dd></div>}
              {state.payments.filter((p) => p.status === "succeeded").map((p) => (
                <div key={p.id} className="flex justify-between gap-3 text-text-secondary">
                  <dt>{p.method === "cash" ? t("ons.g.paidCash") : t("ons.g.paidBy", { name: guestName(p.guest_id) })}</dt>
                  <dd className="tnum">{formatMoney(p.amount)}{p.tip > 0 ? ` + ${formatMoney(p.tip)}` : ""}{p.service_fee > 0 ? ` + ${formatMoney(p.service_fee)}` : ""}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-text-light">{t("ons.g.receiptKept")}</p>
          </section>
        )}

        {!state.reviewed && !reviewSent && order ? (
          <section className="mt-6 rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-bold">{t("ons.g.rateTitle", { name: landing.restaurant?.name ?? "" })}</h2>
            <div className="mt-3"><StarPicker value={rating} onChange={setRating} label={t("ons.g.rateTitle", { name: "" })} /></div>
            <Field label={t("ons.g.reviewBody")} htmlFor="visit-review" className="mt-3">
              <Textarea id="visit-review" rows={3} maxLength={2000} value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} />
            </Field>
            <div className="mt-5 rounded-md bg-surface-2 p-4">
              <p className="text-sm font-semibold">{t("ons.g.platformTitle")}</p>
              <p className="text-xs text-text-secondary">{t("ons.g.platformOptional")}</p>
              <div className="mt-2"><StarPicker value={platformRating} onChange={setPlatformRating} label={t("ons.g.platformTitle")} /></div>
              <Textarea className="mt-2" rows={2} maxLength={2000} value={platformBody} onChange={(e) => setPlatformBody(e.target.value)} placeholder={t("ons.g.platformPh")} aria-label={t("ons.g.platformTitle")} />
            </div>
            <Button fullWidth className="mt-4" disabled={pending || rating < 1} loading={pending} onClick={sendReview}>{t("ons.g.sendReview")}</Button>
          </section>
        ) : (state.reviewed || reviewSent) && (
          <p className="mt-6 text-center text-sm text-success">{t("ons.g.reviewThanks")}</p>
        )}

        <Button variant="ghost" fullWidth className="mt-6" onClick={resetVisit}>{t("ons.g.newVisit")}</Button>
      </main>
    );
  }

  /* ── 4. Paying online right now ──────────────────────────────────────── */
  if (attempt) return (
    <main className="mx-auto min-h-[100dvh] max-w-lg px-4 py-8">
      <PaymentPendingView
        body={t("ons.g.confirmOnPhone")}
        hint={t("ons.g.checksAutomatically")}
        amountLabel={t("ons.g.total")} amount={formatMoney(attemptTotal)}
        referenceLabel={t("ons.g.reference")} reference={state.order?.reference ?? "—"}
        phoneLabel={t("ons.g.momoNumber")} phone={phone}
        gatewayLabel={t("ons.g.securePayment")} instruction={instruction}
      />
    </main>
  );

  /* ── 5. At the table ─────────────────────────────────────────────────── */
  const presencePending = state.guest.status === "pending";
  const billItems = state.rounds.flatMap((round) =>
    round.dining_round_items
      .filter((item) => item.status === "accepted")
      .map((item) => ({ ...item, guestId: round.guest_id })));
  const byGuest = new Map<string | null, typeof billItems>();
  for (const item of billItems) byGuest.set(item.guestId, [...(byGuest.get(item.guestId) ?? []), item]);

  function itemBadge(status: string): { tone: BadgeTone; label: string } {
    if (status === "accepted") return { tone: "success", label: kitchenLabel };
    if (status === "rejected") return { tone: "error", label: t("ons.g.declined") };
    return presencePending
      ? { tone: "warning", label: t("ons.g.waitingPresence") }
      : { tone: "warning", label: t("ons.g.waitingWaiter") };
  }

  return (
    <main className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-6 pb-32">
      {noticeToast}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">{landing.restaurant?.name}</p>
          <h1 className="font-display text-2xl font-bold">{t("ons.g.table", { number: landing.table.number })}</h1>
          <p className="text-sm text-text-secondary">
            {state.guest.name}
            {state.session.kind === "group" ? ` · ${t("ons.g.groupBill", { count: state.guests.filter((g) => g.status !== "rejected" && g.status !== "expired").length })}` : ` · ${t("ons.g.soloBill")}`}
          </p>
        </div>
        {alertsControl}
      </header>
      {pushStatus === "unavailable" && <p className="mt-2 text-xs text-text-secondary">{t("ons.g.keepOpen")}</p>}

      {presencePending && (
        <section className="mt-5 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-light p-4 sm:flex-row sm:items-center">
          <Clock3 className="size-6 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("ons.g.presenceTitle")}</p>
            <p className="text-sm text-text-secondary">{t("ons.g.presenceBody")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => quick("call_waiter")}><Bell className="size-4" />{t("ons.g.callWaiter")}</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={withdraw}><X className="size-4" />{t("tbg.cancelRequest")}</Button>
          </div>
        </section>
      )}

      {state.session.kind === "group" && state.session.code && (
        <section className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary-light p-4">
          <Users className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("ons.g.shareCode")}</p>
            <p className="text-xs text-text-secondary">{t("ons.g.shareCodeBody")}</p>
          </div>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(state.session.code ?? ""); setNotice(t("ons.g.codeCopied")); }}
            className="tnum inline-flex items-center gap-2 rounded-md border border-primary bg-surface px-4 py-2 font-display text-2xl font-bold tracking-[0.3em] text-primary">
            {state.session.code}<Copy className="size-4" aria-hidden />
          </button>
        </section>
      )}

      {!presencePending && (
        <section className="mt-6">
          <h2 className="font-display text-xl font-bold">{t("ons.g.atYourTable")}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Button variant="outline" onClick={() => setPayOpen((value) => !value)}><ReceiptText className="size-4" />{t("ons.g.bill")}</Button>
            <Button variant="outline" disabled={pending} onClick={() => quick("call_waiter")}><Bell className="size-4" />{t("ons.g.callWaiter")}</Button>
            <Button variant="outline" disabled={pending} onClick={() => quick("water")}><Droplets className="size-4" />{t("ons.g.water")}</Button>
            <Button variant="outline" disabled={pending} onClick={() => quick("cutlery")}><HandPlatter className="size-4" />{t("ons.g.cutlery")}</Button>
            <Button variant="outline" disabled={pending} onClick={() => quick("help")}><UtensilsCrossed className="size-4" />{t("ons.g.help")}</Button>
          </div>
        </section>
      )}

      {/* ── The bill ─────────────────────────────────────────────────── */}
      {payOpen && !presencePending && (
        <section className="mt-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-bold">{state.session.kind === "group" ? t("ons.g.sharedBill") : t("ons.g.yourBill")}</h2>
          {billItems.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">{t("ons.g.nothingAccepted")}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {[...byGuest.entries()].map(([guestId, items]) => (
                <div key={guestId ?? "staff"}>
                  {state.session.kind === "group" && <p className="text-xs font-semibold uppercase text-text-secondary">{guestId === state.guest.id ? t("ons.g.you") : guestName(guestId)}</p>}
                  <ul className="divide-y divide-border">{items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0 break-words">{item.quantity}× {item.name}{item.options_label ? ` · ${item.options_label}` : ""}</span>
                      <span className="tnum shrink-0 font-semibold">{formatMoney(item.unit_price * item.quantity)}</span>
                    </li>
                  ))}</ul>
                </div>
              ))}
            </div>
          )}
          <dl className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between"><dt>{t("ons.g.food")}</dt><dd className="tnum">{formatMoney(Number(state.order?.subtotal ?? 0))}</dd></div>
            {state.session.depositCredit > 0 && <div className="flex justify-between text-success"><dt>{t("ons.g.depositDeducted")}</dt><dd className="tnum">−{formatMoney(state.session.depositCredit)}</dd></div>}
            {bill.paid > 0 && <div className="flex justify-between text-text-secondary"><dt>{t("ons.g.alreadyPaid")}</dt><dd className="tnum">−{formatMoney(bill.paid)}</dd></div>}
            {bill.inFlight > 0 && <div className="flex justify-between text-text-secondary"><dt>{t("ons.g.beingPaid")}</dt><dd className="tnum">−{formatMoney(bill.inFlight)}</dd></div>}
            <div className="flex justify-between pt-1 text-base font-bold text-primary"><dt>{t("ons.g.leftToPay")}</dt><dd className="tnum">{formatMoney(bill.remaining)}</dd></div>
          </dl>
          {hasPendingDishes && <p className="mt-3 rounded-md bg-warning-light p-3 text-sm text-warning">{t("ons.g.pendingDishesNote")}</p>}

          {bill.remaining > 0 && (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              {/* On site: the waiter handles it — no split here. */}
              <div className="rounded-md border border-border p-4">
                <p className="font-semibold">{t("ons.g.payOnSite")}</p>
                <p className="mt-1 text-sm text-text-secondary">{t("ons.g.payOnSiteBody")}</p>
                <Button className="mt-3" variant="outline" disabled={pending} onClick={() => quick("bill")}><Bell className="size-4" />{t("ons.g.askForBill")}</Button>
              </div>

              <div className="rounded-md border border-primary/30 p-4">
                <p className="flex items-center gap-2 font-semibold"><CreditCard className="size-4" />{t("ons.g.payOnline")}</p>
                <div className="mt-3 grid gap-2">
                  <Radio name="pay-mode" checked={mode === "all"} onChange={() => setMode("all")} label={t("ons.g.modeAll")} trailing={formatMoney(bill.remaining)} />
                  {state.session.kind === "group" && <Radio name="pay-mode" checked={mode === "mine"} onChange={() => setMode("mine")} disabled={bill.mine <= 0} label={t("ons.g.modeMine")} trailing={formatMoney(Math.min(bill.mine, bill.remaining))} />}
                  <Radio name="pay-mode" checked={mode === "equal"} onChange={() => setMode("equal")} label={t("ons.g.modeEqual")} />
                  {mode === "equal" && (
                    <div className="flex items-center gap-3 pl-7">
                      <button type="button" aria-label="-1" onClick={() => setParts((n) => Math.max(2, n - 1))} className="grid size-9 place-items-center rounded-full border border-border"><Minus className="size-4" /></button>
                      <span className="tnum w-24 text-center text-sm font-semibold">{t("ons.g.parts", { count: parts })}</span>
                      <button type="button" aria-label="+1" onClick={() => setParts((n) => Math.min(50, n + 1))} className="grid size-9 place-items-center rounded-full border border-border"><Plus className="size-4" /></button>
                    </div>
                  )}
                  <Radio name="pay-mode" checked={mode === "amount"} onChange={() => setMode("amount")} label={t("ons.g.modeAmount")} />
                  {mode === "amount" && (
                    <Input className="ml-7 w-auto" inputMode="numeric" value={customAmount} onChange={(e) => setCustomAmount(e.target.value.replace(/\D/g, ""))}
                      placeholder={t("ons.g.amountPh", { min: formatMoney(MIN_PART_PAYMENT), max: formatMoney(bill.remaining) })} aria-label={t("ons.g.modeAmount")} />
                  )}
                </div>

                {landing.tipsEnabled && (
                  <div className="mt-4">
                    <p className="text-sm font-semibold">{t("ons.g.tip")} <span className="font-normal text-text-secondary">({t("ons.g.optional")})</span></p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["none", ...TIP_PERCENTS.map(String), "custom"] as ("none" | "5" | "10" | "custom")[]).map((choice) => (
                        <button key={choice} type="button" aria-pressed={tipChoice === choice} onClick={() => setTipChoice(choice)}
                          className={cn("min-h-10 rounded-full border px-4 text-sm font-semibold", tipChoice === choice ? "border-primary bg-primary text-primary-fg" : "border-border")}>
                          {choice === "none" ? t("ons.g.noTip") : choice === "custom" ? t("ons.g.otherTip") : `${choice} %`}
                        </button>
                      ))}
                    </div>
                    {tipChoice === "custom" && (
                      <Input className="mt-2" inputMode="numeric" value={customTip} onChange={(e) => setCustomTip(e.target.value.replace(/\D/g, ""))} placeholder="FCFA" aria-label={t("ons.g.otherTip")} />
                    )}
                    <p className="mt-1 text-xs text-text-light">{t("ons.g.tipGoesToRestaurant")}</p>
                  </div>
                )}

                <dl className="mt-4 space-y-1 rounded-md bg-surface-2 p-3 text-sm">
                  <div className="flex justify-between"><dt>{t("ons.g.yourShare")}</dt><dd className="tnum">{formatMoney(quote.share)}</dd></div>
                  {quote.tip > 0 && <div className="flex justify-between"><dt>{t("ons.g.tip")}</dt><dd className="tnum">{formatMoney(quote.tip)}</dd></div>}
                  <div className="flex justify-between text-text-secondary"><dt>{t("ons.g.fee", { pct: landing.serviceChargePercent })}</dt><dd className="tnum">{formatMoney(quote.fee)}</dd></div>
                  <div className="flex justify-between font-bold text-primary"><dt>{t("ons.g.total")}</dt><dd className="tnum">{formatMoney(quote.total)}</dd></div>
                </dl>
                {!share.ok && share.reason !== "nothingToPay" && (
                  <p className="mt-2 text-xs text-error">{share.reason === "nothingMine" ? t("ons.err.nothingMine") : share.reason === "invalidParts" ? t("ons.err.invalidParts") : t("ons.err.invalidAmount")}</p>
                )}
                <Field label={t("ons.g.momoNumber")} htmlFor="pay-phone" className="mt-3">
                  <Input id="pay-phone" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6XXXXXXXX" />
                </Field>
                <Button fullWidth className="mt-3" disabled={pending || !share.ok || phone.replace(/\D/g, "").length < 9 || paymentInFlight} loading={pending} onClick={pay}>
                  <WalletCards className="size-4" />{t("ons.g.payAmount", { amount: formatMoney(quote.total) })}
                </Button>
                {paymentInFlight && <p className="mt-2 text-xs text-warning">{t("tbg.err.paymentActive")}</p>}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── My dishes and their progress ──────────────────────────────── */}
      {myRounds.length > 0 && <section className="mt-8">
        <h2 className="font-display text-xl font-bold">{t("ons.g.myOrders")}</h2>
        <ul className="mt-3 space-y-3">{myRounds.map((round) => (
          <li key={round.id} className="rounded-lg border border-border bg-surface p-4">
            {round.dining_round_items.map((item) => {
              const badge = itemBadge(item.status);
              return <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2 last:border-0">
                <div className="min-w-0"><p className="text-sm font-semibold">{item.quantity}× {item.name}</p>
                  {item.rejection_reason && <p className="mt-1 text-xs text-error">{t("ons.g.reason")}: {item.rejection_reason}</p>}</div>
                <Badge tone={badge.tone}>{item.status === "accepted" && <ChefHat className="size-3" aria-hidden />}{badge.label}</Badge>
              </div>;
            })}
          </li>
        ))}</ul>
      </section>}

      <section className="mt-8">
        <h2 className="font-display text-xl font-bold">{t("ons.g.messages")}</h2>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border bg-surface p-3" aria-live="polite">
          {state.messages.length ? state.messages.map((entry) => (
            <div key={entry.id} className={`rounded-md px-3 py-2 text-sm ${entry.sender_kind === "guest" ? "ml-8 bg-primary-light" : "mr-8 bg-surface-2"}`}>
              <p className="text-xs font-semibold text-text-secondary">{entry.sender_kind === "guest" ? t("ons.g.you") : entry.sender_kind === "staff" ? t("ons.g.restaurant") : t("ons.g.update")}</p>
              <p className="mt-0.5 break-words">{entry.body}</p>
            </div>
          )) : <p className="text-sm text-text-secondary">{t("ons.g.noMessages")}</p>}
        </div>
        {!presencePending && (
          <div className="mt-2 flex min-w-0 gap-2">
            <Input className="min-w-0" value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder={t("ons.g.messagePh")} />
            <Button size="icon" aria-label={t("ons.g.send")} disabled={pending || !message.trim()} onClick={() => quick("message", message)}><Send className="size-4" /></Button>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl font-bold">{t("ons.g.menu")}</h2>
        {presencePending && <p className="mt-1 text-sm text-text-secondary">{t("ons.g.orderBeforePresence")}</p>}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label={t("ons.g.menu")}>
          {groups.map((group) => <button key={group.category.id} type="button" role="tab"
            aria-selected={currentGroup?.category.id === group.category.id}
            onClick={() => setSelectedCategory(group.category.id)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${currentGroup?.category.id === group.category.id ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface"}`}>
            {group.category.name}
          </button>)}
        </div>
        {currentGroup && <div className="mt-4">
          <h3 className="mb-3 font-semibold text-primary">{currentGroup.category.name}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {currentGroup.items.map((item) => {
              const sold = !item.is_available || (item.track_stock && item.stock_quantity === 0);
              const hasOptions = (menuItems.get(item.id)?.optionGroups.length ?? 0) > 0;
              return <button key={item.id} type="button" disabled={Boolean(sold)}
                onClick={() => add(item)}
                className="flex min-h-28 w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left disabled:opacity-45">
                <GuestDishPhoto src={item.image_url} name={item.name} />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{item.name}</p>
                  {item.description && <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{item.description}</p>}
                  <p className="mt-2 font-bold text-primary">{formatMoney(item.price)}</p>
                  {hasOptions && <p className="mt-0.5 text-xs text-text-light">{t("tbg.options")}</p>}
                </div>
                <Plus className="size-5 shrink-0" />
              </button>;
            })}
          </div>
        </div>}
      </section>

      {errorToast}
      {cart.length > 0 && <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
        <div className="mx-auto max-w-3xl">
          {cartOpen && <div className="mb-3 max-h-[45dvh] space-y-2 overflow-y-auto" aria-label={t("ons.g.basket")}>
            <div className="flex items-center justify-between"><p className="font-semibold">{t("ons.g.basket")}</p><button type="button" className="inline-flex items-center gap-1 text-sm text-error" onClick={() => { setCart([]); setCartOpen(false); }}><Trash2 className="size-4" />{t("ons.g.emptyBasket")}</button></div>
            {cart.map((line) => <div key={line.key} className="flex items-center gap-2 rounded-md border border-border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.name}</p>
                {line.optionsLabel && <p className="truncate text-xs text-text-secondary">{line.optionsLabel}</p>}
                {line.notes && <p className="truncate text-xs italic text-text-light">« {line.notes} »</p>}
                <p className="text-xs text-text-secondary">{formatMoney(line.price * line.quantity)}</p>
              </div>
              <button type="button" aria-label={`-1 ${line.name}`} onClick={() => changeQuantity(line.key, -1)} className="grid size-9 place-items-center rounded-full border border-border"><Minus className="size-4" /></button>
              <span className="w-5 text-center text-sm font-semibold">{line.quantity}</span>
              <button type="button" aria-label={`+1 ${line.name}`} onClick={() => changeQuantity(line.key, 1)} className="grid size-9 place-items-center rounded-full border border-border"><Plus className="size-4" /></button>
            </div>)}
            <Field label={t("tbg.basketNote")} htmlFor="guest-round-note">
              <Textarea id="guest-round-note" rows={2} maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("tbg.basketNotePh")} />
            </Field>
          </div>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setCartOpen((value) => !value)} aria-expanded={cartOpen} className="min-w-0 flex-1 text-left"><p className="font-semibold">{t("ons.g.basketCount", { count: cart.reduce((sum, line) => sum + line.quantity, 0) })}</p><p className="font-bold text-primary">{formatMoney(cartTotal)}</p></button>
            <Button size="lg" onClick={submit} loading={pending}><ShoppingBag className="size-4" />{t("ons.g.sendOrder")}</Button>
          </div>
        </div>
      </aside>}
      <ModifierSheet
        item={sheetItem}
        restaurant={{ id: "", name: landing.restaurant?.name ?? "", slug: "" }}
        open={sheetItem !== null}
        onClose={() => setSheetItem(null)}
        onAddLine={(line) => addLine({
          menuItemId: line.menuItemId,
          name: line.name,
          price: line.unitPrice,
          quantity: line.quantity,
          optionIds: line.options.map((option) => option.optionId),
          optionsLabel: line.options.map((option) => option.optionName).join(" · "),
          notes: line.notes,
        })}
      />
    </main>
  );
}
