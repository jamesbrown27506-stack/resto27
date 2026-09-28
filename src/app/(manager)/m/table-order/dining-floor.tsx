"use client";

import { LIVE_FALLBACK_MS, useRestaurantSignal, useSignalLive } from "@/lib/realtime/restaurant-signal";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Banknote, Check, Clock3, MessageSquare, Plus, ReceiptText, Send, Ticket, User, UserCheck, Users, X,
} from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { formatMoney } from "@/lib/format/currency";
import {
  applyVoucherToBill,
  closeEmptyDiningBill,
  confirmDiningPresence,
  decideDiningGuest,
  decideDiningItem,
  decideDiningItems,
  recordDiningCash,
  sendStaffDiningMessage,
  setMyDiningNotifications,
} from "@/lib/data/dining-actions";
import { useRouter } from "next/navigation";
import { localizeActionError } from "@/lib/i18n/staff-errors";
import { billDue } from "@/lib/dining/bill";

type Guest = { id: string; display_name: string; status: string; created_at: string };
type Item = {
  id: string; name: string; quantity: number; unit_price: number; options_label: string | null; status: string; rejection_reason: string | null;
  /** Customizable dish (0069): the waiter sets the price when accepting. */
  price_to_confirm?: boolean | null;
  price_max?: number | null;
};
type Round = { id: string; guest_id: string | null; status: string; subtotal: number; notes: string | null; created_at: string; added_by_staff?: string | null; dining_round_items: Item[] };
type Msg = { id: string; guest_id: string | null; sender_kind: string; kind: string; body: string; created_at: string };
type Payment = { id: string; guest_id: string | null; method: string; split_mode: string; amount: number; tip: number; service_fee: number; status: string; created_at: string };
type DiningOrder = { id: string; reference: string; status: string; subtotal: number; total: number; service_charge: number; is_paid: boolean; payment_method: string; order_items: { id: string; name: string; quantity: number; unit_price: number; options_label: string | null }[] };
type TableRef = { id: string; number: string; public_token: string };
export type DiningFloorSession = {
  id: string;
  status: string;
  kind?: "solo" | "group" | null;
  join_code?: string | null;
  label?: string | null;
  presence_confirmed_at?: string | null;
  deposit_credit?: number | null;
  reservation_id?: string | null;
  opened_by_staff?: boolean | null;
  order_id: string | null;
  created_at?: string;
  restaurant_tables: TableRef | TableRef[];
  dining_guests: Guest[];
  dining_rounds: Round[];
  dining_messages: Msg[];
  dining_payments?: Payment[];
  orders: DiningOrder | DiningOrder[] | null;
};

const IN_FLIGHT_MS = 16 * 60_000;

const copy = {
  en: {
    empty: "No open bills",
    emptyHelp: "A bill opens when a guest scans a table QR code, or when you add dishes for a table below.",
    title: "Table bills",
    help: "One table can hold several bills — a group, or strangers each paying their own. Confirm the people you can see, then their dishes go to the kitchen.",
    print: "Print QR cards",
    table: "Table",
    solo: "Individual bill",
    group: "Group bill",
    code: "Code",
    staffBill: "Opened by staff",
    presencePending: "Presence to confirm",
    presenceConfirmed: "Presence confirmed",
    confirmPresence: "Confirm presence",
    refusePresence: "Refuse",
    presenceDone: "Presence confirmed — their dishes can go to the kitchen",
    presenceRefused: "Bill refused",
    people: "People on this bill",
    approve: "Approve",
    reject: "Remove",
    guestApproved: "Guest approved",
    guestRejected: "Guest removed",
    newOrder: "Dishes to decide",
    waitingPresence: "Waiting for presence confirmation",
    staffAdded: "Added by staff",
    accept: "Accept",
    rejectDish: "Decline",
    cancel: "Cancel",
    rejectTitle: "Why is this dish unavailable?",
    rejectReason: "Reason shown to the guest",
    rejectHint: "The other dishes stay unchanged.",
    rejectRequired: "Please give a reason of at least 5 characters.",
    selectAll: "Select all pending dishes",
    selected: "selected",
    acceptSelected: "Accept selected",
    rejectSelected: "Decline selected",
    bulkRejectTitle: "Why are these dishes unavailable?",
    bulkAccepted: "Selected dishes accepted",
    bulkRejected: "Selected dishes declined and guests notified",
    dishAccepted: "Dish accepted — sent to the kitchen",
    dishRejected: "Dish declined and guest notified",
    bill: "Bill",
    byStaff: "Waiter",
    food: "Dishes",
    deposit: "Booking deposit",
    paidOnline: "Paid online",
    paidCash: "Paid in cash",
    tip: "tip",
    inFlight: "Mobile Money in progress",
    remaining: "Left to pay",
    settled: "Settled",
    addDishes: "Add dishes",
    voucher: "Booking voucher",
    voucherPh: "R237-XXXX-XXXX",
    applyVoucher: "Apply",
    voucherApplied: "Voucher applied — deposit deducted",
    cash: "Remaining paid in cash",
    cashDone: "Bill settled and closed",
    closeEmpty: "Close empty bill",
    closedEmpty: "Bill closed",
    cashTitle: "Confirm the cash payment",
    cashWarning: "Record this only once you have received the whole remaining amount in cash. Online payments already made are counted.",
    cashConfirm: "I received the full remaining amount in cash",
    cashAmount: "Cash to collect",
    closeZero: "Nothing left to pay — close the bill",
    messages: "Messages",
    staff: "Staff",
    noMessages: "No messages yet.",
    reply: "Reply to this bill…",
    replyTo: "Reply to",
    sent: "Reply sent",
    commands: "Bill",
    conversation: "Messages",
    noOrders: "No dishes to decide.",
    alerts: "Table alerts for me",
    alertsHelp: "New bills, food orders, calls and payments. Push requires notifications on this device.",
    alertsSaved: "Table alert preference saved",
    alertsFailed: "Could not save the table alert preference",
    error: "Something went wrong. Refresh and try again.",
    waiting: "waiting",
    priceTitle: "Price of this dish",
    priceHint: "The guest described what they want. Set the price within the range they were shown.",
    priceRange: "Between {min} and {max}",
    priceAccept: "Accept at this price",
    toConfirm: "price to confirm",
  },
  fr: {
    empty: "Aucune addition ouverte",
    emptyHelp: "Une addition s’ouvre quand un client scanne le QR d’une table, ou quand vous ajoutez des plats pour une table ci-dessous.",
    title: "Additions en salle",
    help: "Une table peut avoir plusieurs additions — un groupe, ou des inconnus qui paient chacun la leur. Confirmez les personnes que vous voyez : leurs plats partent alors en cuisine.",
    print: "Imprimer les QR codes",
    table: "Table",
    solo: "Addition individuelle",
    group: "Addition de groupe",
    code: "Code",
    staffBill: "Ouverte par le personnel",
    presencePending: "Présence à confirmer",
    presenceConfirmed: "Présence confirmée",
    confirmPresence: "Confirmer la présence",
    refusePresence: "Refuser",
    presenceDone: "Présence confirmée — leurs plats peuvent partir en cuisine",
    presenceRefused: "Addition refusée",
    people: "Personnes sur cette addition",
    approve: "Accepter",
    reject: "Retirer",
    guestApproved: "Client accepté",
    guestRejected: "Client retiré",
    newOrder: "Plats à traiter",
    waitingPresence: "En attente de confirmation de présence",
    staffAdded: "Ajouté par le personnel",
    accept: "Accepter",
    rejectDish: "Refuser",
    cancel: "Annuler",
    rejectTitle: "Pourquoi ce plat est-il indisponible ?",
    rejectReason: "Motif envoyé au client",
    rejectHint: "Les autres plats ne changent pas.",
    rejectRequired: "Indiquez un motif d’au moins 5 caractères.",
    selectAll: "Sélectionner tous les plats en attente",
    selected: "sélectionné(s)",
    acceptSelected: "Accepter la sélection",
    rejectSelected: "Refuser la sélection",
    bulkRejectTitle: "Pourquoi ces plats sont-ils indisponibles ?",
    bulkAccepted: "Plats sélectionnés acceptés",
    bulkRejected: "Plats sélectionnés refusés et clients prévenus",
    dishAccepted: "Plat accepté — envoyé en cuisine",
    dishRejected: "Plat refusé et client prévenu",
    bill: "Addition",
    byStaff: "Serveur",
    food: "Plats",
    deposit: "Acompte de réservation",
    paidOnline: "Payé en ligne",
    paidCash: "Payé en espèces",
    tip: "pourboire",
    inFlight: "Mobile Money en cours",
    remaining: "Reste à payer",
    settled: "Réglée",
    addDishes: "Ajouter des plats",
    voucher: "Bon de réservation",
    voucherPh: "R237-XXXX-XXXX",
    applyVoucher: "Appliquer",
    voucherApplied: "Bon appliqué — acompte déduit",
    cash: "Reste payé en espèces",
    cashDone: "Addition réglée et fermée",
    closeEmpty: "Fermer l’addition vide",
    closedEmpty: "Addition fermée",
    cashTitle: "Confirmer le paiement en espèces",
    cashWarning: "N’enregistrez qu’après avoir reçu tout le reste en espèces. Les paiements en ligne déjà faits sont déduits.",
    cashConfirm: "J’ai reçu tout le reste en espèces",
    cashAmount: "Espèces à encaisser",
    closeZero: "Rien à payer — clôturer l’addition",
    messages: "Messages",
    staff: "Équipe",
    noMessages: "Aucun message pour le moment.",
    reply: "Répondre à cette addition…",
    replyTo: "Répondre à",
    sent: "Réponse envoyée",
    commands: "Addition",
    conversation: "Messages",
    noOrders: "Aucun plat à traiter.",
    alerts: "Mes alertes de table",
    alertsHelp: "Nouvelles additions, commandes, appels et paiements. Le push doit être activé sur cet appareil.",
    alertsSaved: "Préférence d’alerte enregistrée",
    alertsFailed: "Impossible d’enregistrer la préférence d’alerte",
    error: "Une erreur est survenue. Actualisez et réessayez.",
    waiting: "en attente",
    priceTitle: "Prix de ce plat",
    priceHint: "Le client a décrit ce qu’il veut. Fixez le prix dans la fourchette qui lui a été annoncée.",
    priceRange: "Entre {min} et {max}",
    priceAccept: "Accepter à ce prix",
    toConfirm: "prix à confirmer",
  },
} as const;

function tableOf(session: DiningFloorSession): TableRef | undefined {
  return Array.isArray(session.restaurant_tables) ? session.restaurant_tables[0] : session.restaurant_tables;
}
function orderOf(session: DiningFloorSession): DiningOrder | null {
  return (Array.isArray(session.orders) ? session.orders[0] : session.orders) ?? null;
}

/** The figures the bill card shows — the database's rules, previewed. */
function billOf(session: DiningFloorSession, now: number) {
  const order = orderOf(session);
  const payments = session.dining_payments ?? [];
  const due = billDue(Number(order?.subtotal ?? 0), Number(session.deposit_credit ?? 0));
  const paid = payments.filter((p) => p.status === "succeeded").reduce((sum, p) => sum + p.amount, 0);
  const inFlight = payments
    .filter((p) => p.status === "pending" && now - Date.parse(p.created_at) < IN_FLIGHT_MS)
    .reduce((sum, p) => sum + p.amount, 0);
  return { order, payments, due, paid, inFlight, remaining: Math.max(0, due - paid) };
}

export function DiningFloor({
  sessions,
  focusSessionId,
  canCollect,
  canSeat,
  notificationsEnabled,
  now,
}: {
  sessions: DiningFloorSession[];
  focusSessionId?: string;
  /** `payments.collect` — record cash. */
  canCollect: boolean;
  /** `reservations.seat` — apply a booking voucher to a bill. */
  canSeat: boolean;
  notificationsEnabled: boolean;
  /** Server-stamped render instant. */
  now: number;
}) {
  const { toast } = useToast();
  const { locale } = useLocale();
  const t = copy[locale];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState<Record<string, string>>({});
  const [replyGuests, setReplyGuests] = useState<Record<string, string>>({});
  const [rejectItem, setRejectItem] = useState<{ id: string; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(notificationsEnabled);
  const [selectedSessionId, setSelectedSessionId] = useState(focusSessionId ?? sessions[0]?.id ?? "");
  const [mobileTab, setMobileTab] = useState<"commands" | "messages">("commands");
  const [cashSessionId, setCashSessionId] = useState<string | null>(null);
  const [cashAcknowledged, setCashAcknowledged] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  /** A customizable dish being accepted: its price is asked first (0069). */
  const [pricing, setPricing] = useState<{ item: Item; note: string | null; draft: string } | null>(null);

  /*
    FAST ONLY WHILE A BILL IS WAITING ON US. Live (0066): the branch signal
    refreshes on change and the clock is a 5-minute net; without it, 8 s
    while someone waits (presence, dishes, a payment) and 30 s otherwise,
    nothing while the tab is hidden.
  */
  const hot = sessions.some(
    (session) =>
      !session.presence_confirmed_at ||
      (session.dining_guests ?? []).some((guest) => guest.status === "pending") ||
      (session.dining_rounds ?? []).some((round) => round.status === "pending") ||
      (session.dining_payments ?? []).some((p) => p.status === "pending"),
  );
  const live = useSignalLive();
  useRestaurantSignal(() => {
    if (document.visibilityState === "visible") router.refresh();
  });
  useEffect(() => {
    const everyMs = live ? LIVE_FALLBACK_MS : hot ? 8_000 : 30_000;
    let timer: number | null = null;
    const begin = () => {
      if (timer === null) timer = window.setInterval(() => router.refresh(), everyMs);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        begin();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") begin();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, hot, live]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) {
    start(async () => {
      const result = await fn();
      toast(result.ok ? success : localizeActionError(result.error, locale, t.error), result.ok ? "success" : "error");
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  function rejectSelectedItem() {
    if (!rejectItem) return;
    if (rejectReason.trim().length < 5) {
      toast(t.rejectRequired, "error");
      return;
    }
    run(() => decideDiningItem(rejectItem.id, false, rejectReason), t.dishRejected, () => {
      setRejectItem(null);
      setRejectReason("");
    });
  }

  function runBulk(ids: string[], approve: boolean, reason?: string) {
    if (!ids.length) return;
    start(async () => {
      const result = await decideDiningItems(ids, approve, reason);
      toast(result.ok ? (approve ? t.bulkAccepted : t.bulkRejected) : localizeActionError(result.error, locale, t.error), result.ok ? "success" : "error");
      setSelectedItems(result.failedIds);
      if (result.ok) { setBulkRejectOpen(false); setBulkReason(""); }
      router.refresh();
    });
  }

  function toggleAlerts(enabled: boolean) {
    const previous = alertsEnabled;
    setAlertsEnabled(enabled);
    start(async () => {
      const result = await setMyDiningNotifications(enabled);
      if (!result.ok) setAlertsEnabled(previous);
      toast(result.ok ? t.alertsSaved : localizeActionError(result.error, locale, t.alertsFailed), result.ok ? "success" : "error");
    });
  }

  // Bills grouped by table, the table's own number order; the focused one first.
  const ordered = [...sessions].sort((a, b) => {
    if (a.id === focusSessionId) return -1;
    if (b.id === focusSessionId) return 1;
    const ta = tableOf(a)?.number ?? "";
    const tb = tableOf(b)?.number ?? "";
    return ta.localeCompare(tb, undefined, { numeric: true }) || (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
  const selected = ordered.find((session) => session.id === selectedSessionId) ?? ordered[0];
  const cashSession = ordered.find((session) => session.id === cashSessionId);
  const cashBill = cashSession ? billOf(cashSession, now) : null;

  const alertControl = (
    <Switch label={t.alerts} description={t.alertsHelp} checked={alertsEnabled} disabled={pending}
      onChange={(event) => toggleAlerts(event.target.checked)} className="max-w-sm" />
  );
  const heading = (
    <div className="mb-4 flex flex-col items-start justify-between gap-3 lg:flex-row lg:items-end">
      <div><h2 className="font-display text-xl font-bold">{t.title}</h2><p className="max-w-2xl text-sm text-text-secondary">{t.help}</p></div>
      <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:items-center">
        {alertControl}
        <a href="/m/tables/print" target="_blank" className={buttonClasses({ variant: "outline", size: "sm" })}>{t.print}</a>
      </div>
    </div>
  );

  if (!sessions.length) {
    return (
      <section className="mb-8">
        {heading}
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <UserCheck className="mx-auto size-7 text-text-light" />
          <p className="mt-3 font-semibold">{t.empty}</p>
          <p className="mt-1 text-sm text-text-secondary">{t.emptyHelp}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      {heading}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg border border-border bg-surface p-2 lg:sticky lg:top-4 lg:self-start" aria-label={t.title}>
          <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {ordered.map((session) => {
              const table = tableOf(session);
              const waiting =
                (session.presence_confirmed_at ? 0 : 1) +
                session.dining_guests.filter((guest) => guest.status === "pending" && session.presence_confirmed_at).length +
                session.dining_rounds.flatMap((round) => round.dining_round_items).filter((item) => item.status === "pending").length;
              const names = session.dining_guests.filter((guest) => guest.status !== "rejected" && guest.status !== "expired").map((guest) => guest.display_name);
              return (
                <button key={session.id} type="button"
                  onClick={() => { setSelectedSessionId(session.id); setSelectedItems([]); setMobileTab("commands"); }}
                  className={`min-w-40 rounded-md p-3 text-left transition-colors lg:w-full ${selected?.id === session.id ? "bg-primary text-primary-fg" : "hover:bg-surface-2"}`}>
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                    <span className="flex items-center gap-1.5">{session.kind === "solo" ? <User className="size-3.5" /> : <Users className="size-3.5" />}{t.table} {table?.number}</span>
                    {waiting > 0 && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-warning text-xs text-black">{waiting}</span>}
                  </span>
                  <span className="mt-1 block truncate text-xs opacity-80">{session.label || names.join(", ") || "—"}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {selected && (() => {
          const session = selected;
          const table = tableOf(session);
          const guests = session.dining_guests ?? [];
          const rounds = session.dining_rounds ?? [];
          const messages = session.dining_messages ?? [];
          const { order, payments, remaining, inFlight } = billOf(session, now);
          const confirmed = Boolean(session.presence_confirmed_at);
          const liveGuests = guests.filter((guest) => guest.status === "approved" || guest.status === "pending");
          const replyGuestId = replyGuests[session.id] ?? liveGuests[0]?.id ?? "";
          const guestMessages = messages.filter((message) => !message.guest_id || message.guest_id === replyGuestId);
          const guestName = (id: string | null) => id ? guests.find((guest) => guest.id === id)?.display_name ?? "—" : t.byStaff;
          const pendingItems = rounds.flatMap((round) => round.dining_round_items.filter((item) => item.status === "pending" && !item.price_to_confirm));
          const activeSelection = selectedItems.filter((id) => pendingItems.some((item) => item.id === id));
          const accepted = rounds.flatMap((round) => round.dining_round_items.filter((item) => item.status === "accepted").map((item) => ({ ...item, guestId: round.guest_id })));
          const byGuest = new Map<string | null, typeof accepted>();
          for (const item of accepted) byGuest.set(item.guestId, [...(byGuest.get(item.guestId) ?? []), item]);
          const successful = payments.filter((p) => p.status === "succeeded");

          return (
            <article className={`min-w-0 overflow-hidden rounded-lg border bg-surface ${session.id === focusSessionId ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-bold">{t.table} {table?.number}{session.label ? ` · ${session.label}` : ""}</h3>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span>{session.kind === "solo" ? t.solo : t.group}</span>
                    {session.join_code && <span className="tnum rounded bg-surface-2 px-1.5 py-0.5 font-bold tracking-widest">{t.code} {session.join_code}</span>}
                    {session.opened_by_staff && <span>{t.staffBill}</span>}
                  </p>
                </div>
                <Badge tone={confirmed ? "success" : "warning"}>{confirmed ? t.presenceConfirmed : t.presencePending}</Badge>
              </header>

              {!confirmed && (
                <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning-light p-4">
                  <Clock3 className="size-5 text-warning" />
                  <p className="min-w-0 flex-1 text-sm">{liveGuests.map((guest) => guest.display_name).join(", ")}</p>
                  <Button size="sm" disabled={pending} onClick={() => run(() => confirmDiningPresence(session.id, true), t.presenceDone)}><Check className="size-4" />{t.confirmPresence}</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => confirmDiningPresence(session.id, false), t.presenceRefused)}><X className="size-4" />{t.refusePresence}</Button>
                </div>
              )}

              <div className="mx-4 mt-3 grid grid-cols-2 gap-2 lg:hidden" role="tablist">
                <button type="button" role="tab" aria-selected={mobileTab === "commands"} onClick={() => setMobileTab("commands")} className={`rounded-full px-3 py-2 text-sm font-semibold ${mobileTab === "commands" ? "bg-primary text-primary-fg" : "bg-surface-2"}`}>{t.commands}</button>
                <button type="button" role="tab" aria-selected={mobileTab === "messages"} onClick={() => setMobileTab("messages")} className={`rounded-full px-3 py-2 text-sm font-semibold ${mobileTab === "messages" ? "bg-primary text-primary-fg" : "bg-surface-2"}`}>{t.conversation}</button>
              </div>

              <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-2">
                <div className={`min-w-0 space-y-5 ${mobileTab === "commands" ? "block" : "hidden"} lg:block`}>
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">{t.people}</h4>
                    <ul className="space-y-2">
                      {guests.filter((guest) => guest.status !== "expired").map((guest) => (
                        <li key={guest.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface-2 p-2.5">
                          <span className="min-w-24 flex-1 truncate text-sm font-medium">{guest.display_name}</span>
                          <Badge tone={guest.status === "approved" ? "success" : guest.status === "pending" ? "warning" : "neutral"}>{guest.status === "approved" ? t.presenceConfirmed : guest.status === "pending" ? t.waiting : t.reject}</Badge>
                          {guest.status === "pending" && confirmed && <>
                            <Button size="icon-sm" disabled={pending} aria-label={t.approve} onClick={() => run(() => decideDiningGuest(guest.id, true), t.guestApproved)}><Check className="size-4" /></Button>
                            <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={t.reject} onClick={() => run(() => decideDiningGuest(guest.id, false), t.guestRejected)}><X className="size-4" /></Button>
                          </>}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {pendingItems.length > 0 && confirmed && <div className="rounded-md border border-border bg-surface-2 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={activeSelection.length === pendingItems.length} onChange={(event) => setSelectedItems(event.target.checked ? pendingItems.map((item) => item.id) : [])} />{t.selectAll}</label>
                    {activeSelection.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs text-text-secondary">{activeSelection.length} {t.selected}</span><Button size="sm" disabled={pending} onClick={() => runBulk(activeSelection, true)}>{t.acceptSelected}</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => { setBulkReason(""); setBulkRejectOpen(true); }}>{t.rejectSelected}</Button></div>}
                  </div>}
                  {rounds.filter((round) => round.dining_round_items.some((item) => item.status === "pending")).map((round) => (
                    <div key={round.id} className="rounded-md border border-warning/30 bg-warning-light p-3">
                      <p className="font-semibold">{t.newOrder} · {guestName(round.guest_id)}</p>
                      {!confirmed && <p className="text-xs text-warning">{t.waitingPresence}</p>}
                      {round.notes && <p className="mt-1 break-words text-xs italic">{round.notes}</p>}
                      <ul className="mt-3 space-y-2">
                        {round.dining_round_items.filter((item) => item.status === "pending").map((item) => (
                          <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface p-3">
                            {confirmed && !item.price_to_confirm && <input type="checkbox" aria-label={`${t.selectAll}: ${item.name}`} checked={activeSelection.includes(item.id)} onChange={(event) => setSelectedItems((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} />}
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm font-semibold">{item.quantity}× {item.name}</p>
                              {item.options_label && <p className="text-xs text-text-secondary">{item.options_label}</p>}
                              <p className="text-xs text-text-secondary">
                                {item.price_to_confirm
                                  ? `${formatMoney(item.unit_price)} – ${formatMoney(Math.max(item.unit_price, item.price_max ?? item.unit_price))} · ${t.toConfirm}`
                                  : formatMoney(item.unit_price * item.quantity)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" disabled={pending || !confirmed} onClick={() => item.price_to_confirm
                                ? setPricing({ item, note: round.notes, draft: String(item.unit_price) })
                                : run(() => decideDiningItem(item.id, true), t.dishAccepted)}>{t.accept}</Button>
                              <Button variant="outline" size="sm" disabled={pending || !confirmed} onClick={() => { setRejectItem({ id: item.id, name: item.name }); setRejectReason(""); }}>{t.rejectDish}</Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  {/* ── The bill ─────────────────────────────────────── */}
                  <div className="rounded-md border border-border p-3">
                    <h4 className="flex items-center gap-2 text-sm font-semibold"><ReceiptText className="size-4" />{t.bill}{order ? ` · ${order.reference}` : ""}</h4>
                    {[...byGuest.entries()].map(([guestId, items]) => (
                      <div key={guestId ?? "staff"} className="mt-2">
                        <p className="text-xs font-semibold uppercase text-text-secondary">{guestName(guestId)}</p>
                        {items.map((item) => (
                          <p key={item.id} className="flex justify-between gap-3 text-sm"><span className="min-w-0 break-words">{item.quantity}× {item.name}</span><span className="tnum shrink-0">{formatMoney(item.unit_price * item.quantity)}</span></p>
                        ))}
                      </div>
                    ))}
                    <dl className="mt-3 space-y-1 border-t border-border pt-2 text-sm">
                      <div className="flex justify-between"><dt>{t.food}</dt><dd className="tnum">{formatMoney(Number(order?.subtotal ?? 0))}</dd></div>
                      {Number(session.deposit_credit ?? 0) > 0 && <div className="flex justify-between text-success"><dt>{t.deposit}</dt><dd className="tnum">−{formatMoney(Number(session.deposit_credit))}</dd></div>}
                      {successful.map((p) => (
                        <div key={p.id} className="flex justify-between gap-3 text-text-secondary">
                          <dt>{p.method === "cash" ? t.paidCash : `${t.paidOnline} · ${guestName(p.guest_id)}`}</dt>
                          <dd className="tnum">−{formatMoney(p.amount)}{p.tip > 0 ? ` (+${formatMoney(p.tip)} ${t.tip})` : ""}</dd>
                        </div>
                      ))}
                      {inFlight > 0 && <div className="flex justify-between text-warning"><dt>{t.inFlight}</dt><dd className="tnum">{formatMoney(inFlight)}</dd></div>}
                      <div className="flex justify-between pt-1 font-display text-lg font-bold"><dt>{t.remaining}</dt><dd className="tnum">{formatMoney(remaining)}</dd></div>
                    </dl>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {confirmed && table && (
                      <Link href={`/m/table-order?bill=${session.id}#waiter-order`} className={buttonClasses({ variant: "outline", size: "sm" })}><Plus className="size-4" />{t.addDishes}</Link>
                    )}
                    {canCollect && order && (
                      <Button size="sm" disabled={pending || inFlight > 0 || pendingItems.length > 0} onClick={() => { setCashSessionId(session.id); setCashAcknowledged(false); }}>
                        <Banknote className="size-4" />{remaining > 0 ? t.cash : t.closeZero}
                      </Button>
                    )}
                    {!order && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => closeEmptyDiningBill(session.id), t.closedEmpty)}><X className="size-4" />{t.closeEmpty}</Button>
                    )}
                  </div>

                  {canSeat && confirmed && (
                    <div className="flex min-w-0 flex-wrap items-end gap-2 rounded-md bg-surface-2 p-3">
                      <label className="min-w-0 flex-1 text-xs font-semibold"><span className="flex items-center gap-1"><Ticket className="size-3.5" />{t.voucher}</span>
                        <Input className="mt-1" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} placeholder={t.voucherPh} />
                      </label>
                      <Button size="sm" variant="outline" disabled={pending || voucherCode.replace(/[^A-Z0-9]/g, "").length < 12}
                        onClick={() => run(() => applyVoucherToBill(session.id, voucherCode), t.voucherApplied, () => setVoucherCode(""))}>{t.applyVoucher}</Button>
                    </div>
                  )}
                </div>

                <div className={`min-w-0 ${mobileTab === "messages" ? "block" : "hidden"} lg:block`}>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-4" />{t.messages}</h4>
                  {liveGuests.length > 1 && (
                    <label className="mb-2 block text-xs font-semibold">
                      {t.replyTo}
                      <select className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        value={replyGuestId}
                        onChange={(event) => setReplyGuests((value) => ({ ...value, [session.id]: event.target.value }))}>
                        {liveGuests.map((guest) => <option key={guest.id} value={guest.id}>{guest.display_name}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="flex h-80 flex-col gap-2 overflow-y-auto rounded-md bg-surface-2 p-3" aria-live="polite">
                    {guestMessages.slice(-40).map((message) => <div key={message.id} className={`max-w-[85%] break-words rounded-lg px-3 py-2 text-sm ${message.sender_kind === "guest" ? "self-start bg-surface" : "self-end bg-primary/10"}`}><p className="mb-1 text-xs font-semibold">{message.sender_kind === "guest" ? guestName(message.guest_id) : t.staff}</p><p>{message.body}</p><time className="mt-1 block text-right text-[11px] text-text-secondary">{new Date(message.created_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></div>)}
                    {!guestMessages.length && <p className="text-sm text-text-light">{t.noMessages}</p>}
                  </div>
                  <div className="mt-2 flex min-w-0 gap-2">
                    <Input className="min-w-0" value={text[session.id] ?? ""} onChange={(event) => setText((value) => ({ ...value, [session.id]: event.target.value }))} placeholder={t.reply} />
                    <Button size="icon" aria-label={t.sent} disabled={pending || !replyGuestId || !(text[session.id] ?? "").trim()} onClick={() => {
                      const body = text[session.id] ?? "";
                      run(() => sendStaffDiningMessage(session.id, replyGuestId, body), t.sent, () => setText((value) => ({ ...value, [session.id]: "" })));
                    }}><Send className="size-4" /></Button>
                  </div>
                </div>
              </div>
            </article>
          );
        })()}
      </div>

      <Dialog open={cashSessionId !== null} onClose={() => setCashSessionId(null)} title={t.cashTitle} size="md" footer={<>
        <Button variant="outline" disabled={pending} onClick={() => setCashSessionId(null)}>{t.cancel}</Button>
        <Button disabled={pending || !cashAcknowledged || !cashBill} loading={pending} onClick={() => {
          if (!cashSession || !cashBill) return;
          const id = cashSession.id;
          run(() => recordDiningCash(id, cashBill.remaining), t.cashDone, () => setCashSessionId(null));
        }}>{cashBill && cashBill.remaining > 0 ? t.cash : t.closeZero}</Button>
      </>}>
        <p className="mb-3 rounded-md bg-warning-light p-3 text-sm">{t.cashWarning}</p>
        <p className="flex justify-between font-display text-lg font-semibold"><span>{t.cashAmount}</span><span className="tnum">{formatMoney(cashBill?.remaining ?? 0)}</span></p>
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={cashAcknowledged} onChange={(event) => setCashAcknowledged(event.target.checked)} /><span>{t.cashConfirm}</span></label>
      </Dialog>
      <Dialog open={bulkRejectOpen} onClose={() => setBulkRejectOpen(false)} title={t.bulkRejectTitle} size="sm" footer={<>
        <Button variant="outline" disabled={pending} onClick={() => setBulkRejectOpen(false)}>{t.cancel}</Button>
        <Button variant="danger" disabled={pending || bulkReason.trim().length < 5} loading={pending} onClick={() => {
          const pendingIds = selected?.dining_rounds.flatMap((round) => round.dining_round_items.filter((item) => item.status === "pending").map((item) => item.id)) ?? [];
          runBulk(selectedItems.filter((id) => pendingIds.includes(id)), false, bulkReason);
        }}>{t.rejectSelected}</Button>
      </>}>
        <p className="mb-3 text-sm text-text-secondary">{selectedItems.length} {t.selected}. {t.rejectHint}</p>
        <label className="block text-sm font-medium">{t.rejectReason}<Input className="mt-2" value={bulkReason} maxLength={240} onChange={(event) => setBulkReason(event.target.value)} /></label>
      </Dialog>
      <Dialog open={pricing !== null} onClose={() => setPricing(null)} title={t.priceTitle} size="sm" footer={<>
        <Button variant="outline" disabled={pending} onClick={() => setPricing(null)}>{t.cancel}</Button>
        <Button disabled={pending || !pricing || !(Number(pricing.draft) >= pricing.item.unit_price && Number(pricing.draft) <= Math.max(pricing.item.unit_price, pricing.item.price_max ?? pricing.item.unit_price))}
          loading={pending}
          onClick={() => {
            if (!pricing) return;
            const target = pricing;
            run(() => decideDiningItem(target.item.id, true, undefined, Math.round(Number(target.draft))), t.dishAccepted, () => setPricing(null));
          }}>{t.priceAccept}</Button>
      </>}>
        {pricing && (
          <div className="flex flex-col gap-3">
            <p className="font-semibold">{pricing.item.quantity}× {pricing.item.name}</p>
            {pricing.note && <p className="rounded bg-surface-2 p-2 text-sm italic">« {pricing.note} »</p>}
            <p className="text-sm text-text-secondary">{t.priceHint}</p>
            <Input type="number" inputMode="numeric" step={1} suffix="FCFA"
              min={pricing.item.unit_price} max={Math.max(pricing.item.unit_price, pricing.item.price_max ?? pricing.item.unit_price)}
              value={pricing.draft} aria-label={t.priceTitle}
              onChange={(event) => setPricing((current) => current ? { ...current, draft: event.target.value } : current)} />
            <p className="tnum text-xs text-text-secondary">{t.priceRange.replace("{min}", formatMoney(pricing.item.unit_price)).replace("{max}", formatMoney(Math.max(pricing.item.unit_price, pricing.item.price_max ?? pricing.item.unit_price)))}</p>
          </div>
        )}
      </Dialog>
      <Dialog open={rejectItem !== null} onClose={() => setRejectItem(null)} title={t.rejectTitle} size="sm" footer={<>
        <Button variant="outline" disabled={pending} onClick={() => setRejectItem(null)}>{t.cancel}</Button>
        <Button variant="danger" disabled={pending || rejectReason.trim().length < 5} loading={pending} onClick={rejectSelectedItem}>{t.rejectDish}</Button>
      </>}>
        <p className="mb-3 text-sm font-semibold">{rejectItem?.name}</p>
        <label className="block text-sm font-medium">{t.rejectReason}
          <Input className="mt-2" value={rejectReason} maxLength={240} onChange={(event) => setRejectReason(event.target.value)} />
        </label>
        <p className="mt-2 text-xs text-text-secondary">{t.rejectHint}</p>
      </Dialog>
    </section>
  );
}
