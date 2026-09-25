"use client";

import { LIVE_FALLBACK_MS, useRestaurantSignal, useSignalLive } from "@/lib/realtime/restaurant-signal";
import { useEffect, useState, useTransition } from "react";
import { Check, Clock3, CreditCard, MessageSquare, ReceiptText, Send, UserCheck, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/use-locale";
import { formatMoney } from "@/lib/format/currency";
import {
  closeDiningCash,
  decideDiningGuest,
  decideDiningItem,
  decideDiningItems,
  requestDiningPayment,
  sendStaffDiningMessage,
  setMyDiningNotifications,
} from "@/lib/data/dining-actions";
import { useRouter } from "next/navigation";
import { localizeActionError } from "@/lib/i18n/staff-errors";

type Guest = { id: string; display_name: string; status: string; created_at: string };
type Item = { id: string; name: string; quantity: number; unit_price: number; options_label: string | null; status: string; rejection_reason: string | null };
type Round = { id: string; guest_id: string; status: string; subtotal: number; notes: string | null; created_at: string; dining_round_items: Item[] };
type Msg = { id: string; guest_id: string | null; sender_kind: string; kind: string; body: string; created_at: string };
type DiningOrder = { id: string; reference: string; status: string; total: number; service_charge: number; is_paid: boolean; payment_method: string; order_items: { id: string; name: string; quantity: number; unit_price: number; options_label: string | null }[] };
export type DiningFloorSession = {
  id: string;
  status: string;
  order_id: string | null;
  restaurant_tables: { id: string; number: string; public_token: string } | { id: string; number: string; public_token: string }[];
  dining_guests: Guest[];
  dining_rounds: Round[];
  dining_messages: Msg[];
  orders: DiningOrder | DiningOrder[] | null;
};

const copy = {
  en: {
    empty: "No active guest table sessions",
    emptyHelp: "Requests appear here after a guest scans a table QR code.",
    title: "Guest table sessions",
    help: "Approve the person you can see at the table before accepting food.",
    print: "Print QR cards",
    table: "Table",
    devices: "guest device(s)",
    access: "Access requests",
    approve: "Approve",
    reject: "Reject",
    approved: "Guest approved",
    rejected: "Request rejected",
    settlingAccess: "This table is settling its bill. Decline this request; the guest can scan again after the bill is closed.",
    newOrder: "New order",
    guest: "Guest",
    kitchen: "Order sent to the kitchen",
    accept: "Accept",
    rejectDish: "Decline dish",
    cancel: "Cancel",
    rejectTitle: "Why is this dish unavailable?",
    rejectReason: "Reason shown to the guest",
    rejectHint: "The other dishes in this request stay unchanged.",
    rejectRequired: "Please give a reason of at least 5 characters.",
    selectAll: "Select all pending dishes",
    selected: "selected",
    acceptSelected: "Accept selected",
    rejectSelected: "Decline selected",
    bulkRejectTitle: "Why are these dishes unavailable?",
    bulkAccepted: "Selected dishes accepted",
    bulkRejected: "Selected dishes declined and guests notified",
    chooseGuest: "Reply to guest",
    dishAccepted: "Dish accepted",
    dishRejected: "Dish declined and guest notified",
    messages: "Table messages",
    staff: "Staff",
    noMessages: "No messages yet.",
    reply: "Reply to this table…",
    sent: "Reply sent",
    requestPayment: "Request Mobile Money",
    requested: "Payment request sent",
    cash: "Paid in cash",
    cashDone: "Cash payment recorded",
    commands: "Orders",
    conversation: "Messages",
    people: "People at this table",
    noOrders: "No new orders to decide.",
    cashTitle: "Confirm payment for the entire table",
    cashWarning: "This receipt includes every approved guest at this table. Confirm only after you have collected the full cash amount. If guests are paying separately, do not close this bill.",
    cashConfirm: "I received the full cash amount from everyone on this bill",
    cashAmount: "Cash to collect",
    cashChanged: "The bill may have changed. Review it again before confirming.",
    waiting: "Waiting for payment",
    alerts: "Table alerts for me",
    alertsHelp: "Access requests, food orders and calls. Push requires notifications to be enabled on this device.",
    alertsSaved: "Table alert preference saved",
    alertsFailed: "Could not save the table alert preference",
    error: "Something went wrong. Refresh and try again.",
  },
  fr: {
    empty: "Aucune session de table active",
    emptyHelp: "Les demandes apparaissent ici après qu’un client a scanné le QR code de la table.",
    title: "Sessions clients à table",
    help: "Validez la personne présente à la table avant d’accepter ses plats.",
    print: "Imprimer les QR codes",
    table: "Table",
    devices: "appareil(s) client",
    access: "Demandes d’accès",
    approve: "Accepter",
    reject: "Refuser",
    approved: "Client accepté",
    rejected: "Demande refusée",
    settlingAccess: "Cette table règle son addition. Refusez cette demande ; le client pourra rescanner après la clôture de la visite.",
    newOrder: "Nouvelle commande",
    guest: "Client",
    kitchen: "Commande envoyée en cuisine",
    accept: "Accepter",
    rejectDish: "Refuser le plat",
    cancel: "Annuler",
    rejectTitle: "Pourquoi ce plat est-il indisponible ?",
    rejectReason: "Motif envoyé au client",
    rejectHint: "Les autres plats de cette demande ne changent pas.",
    rejectRequired: "Indiquez un motif d’au moins 5 caractères.",
    selectAll: "Sélectionner tous les plats en attente",
    selected: "sélectionné(s)",
    acceptSelected: "Accepter la sélection",
    rejectSelected: "Refuser la sélection",
    bulkRejectTitle: "Pourquoi ces plats sont-ils indisponibles ?",
    bulkAccepted: "Plats sélectionnés acceptés",
    bulkRejected: "Plats sélectionnés refusés et clients prévenus",
    chooseGuest: "Répondre au client",
    dishAccepted: "Plat accepté",
    dishRejected: "Plat refusé et client prévenu",
    messages: "Messages de la table",
    staff: "Équipe",
    noMessages: "Aucun message pour le moment.",
    reply: "Répondre à cette table…",
    sent: "Réponse envoyée",
    requestPayment: "Demander le paiement Mobile Money",
    requested: "Demande de paiement envoyée",
    cash: "Payé en espèces",
    cashDone: "Paiement en espèces enregistré",
    commands: "Commandes",
    conversation: "Messages",
    people: "Personnes à cette table",
    noOrders: "Aucune nouvelle commande à traiter.",
    cashTitle: "Confirmer le paiement de toute la table",
    cashWarning: "Cette addition inclut tous les clients acceptés à cette table. Confirmez uniquement après avoir reçu le montant total en espèces. Si les clients paient séparément, ne clôturez pas cette addition.",
    cashConfirm: "J’ai reçu le montant total en espèces pour tous les clients de cette addition",
    cashAmount: "Espèces à encaisser",
    cashChanged: "L’addition a peut-être changé. Vérifiez-la avant de confirmer.",
    waiting: "En attente du paiement",
    alerts: "Mes alertes de table",
    alertsHelp: "Demandes d’accès, commandes et appels. Le push doit être activé sur cet appareil.",
    alertsSaved: "Préférence d’alerte enregistrée",
    alertsFailed: "Impossible d’enregistrer la préférence d’alerte",
    error: "Une erreur est survenue. Actualisez et réessayez.",
  },
} as const;

export function DiningFloor({ sessions, focusSessionId, canCollect, notificationsEnabled }: { sessions: DiningFloorSession[]; focusSessionId?: string; /** `payments.collect` — request Mobile Money, close a cash bill. */ canCollect: boolean; notificationsEnabled: boolean }) {
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

  /*
    ─────────────────────────────────────────────────────────────────────────
     FAST ONLY WHILE A TABLE IS WAITING ON US.

     This screen re-rendered the whole floor on the server every 5 s, all
     service long, on every open tablet — one of the largest Vercel CPU lines
     in the Sep 2026 audit, and almost all of it re-reading a floor where
     nothing was waiting. Now:
       · someone is waiting (a guest asking to join, dishes to approve, a
         table settling its bill) and the tab is visible → every 8 s;
       · nothing waiting → every 30 s, just to notice the next request;
       · tab hidden → nothing at all; coming back refreshes at once.
     Guest requests also arrive as notifications, so 30 s is the worst case,
     not the normal one.
    ─────────────────────────────────────────────────────────────────────────
  */
  const hot = sessions.some(
    (session) =>
      session.status === "payment_requested" ||
      (session.dining_guests ?? []).some((guest) => guest.status === "pending") ||
      (session.dining_rounds ?? []).some((round) => round.status === "pending"),
  );
  // LIVE (0066): guest requests, dish approvals and bills bump the branch
  // signal, so while live the floor refreshes on change and polls only as a
  // 5-minute net; the 8 s / 30 s clock is the fallback when it is not.
  const live = useSignalLive();
  useRestaurantSignal(() => {
    if (document.visibilityState === "visible") router.refresh();
  });
  useEffect(() => {
    const everyMs = live ? LIVE_FALLBACK_MS : hot ? 8_000 : 30_000;
    let timer: number | null = null;
    const start = () => {
      if (timer === null) timer = window.setInterval(() => router.refresh(), everyMs);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, hot, live]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const result = await fn();
      toast(result.ok ? success : localizeActionError(result.error, locale, t.error), result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  }

  function rejectSelectedItem() {
    if (!rejectItem) return;
    if (rejectReason.trim().length < 5) {
      toast(t.rejectRequired, "error");
      return;
    }
    start(async () => {
      const result = await decideDiningItem(rejectItem.id, false, rejectReason);
      toast(result.ok ? t.dishRejected : localizeActionError(result.error, locale, t.error), result.ok ? "success" : "error");
      if (result.ok) {
        setRejectItem(null);
        setRejectReason("");
        router.refresh();
      }
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

  const orderedSessions = focusSessionId
    ? [...sessions].sort((a, b) => Number(b.id === focusSessionId) - Number(a.id === focusSessionId))
    : sessions;

  const selectedSession = orderedSessions.find((session) => session.id === selectedSessionId) ?? orderedSessions[0];
  const cashSession = orderedSessions.find((session) => session.id === cashSessionId);
  const cashOrder = cashSession ? (Array.isArray(cashSession.orders) ? cashSession.orders[0] : cashSession.orders) : null;
  const cashGuests = cashSession?.dining_guests.filter((guest) => guest.status === "approved") ?? [];
  const cashAmount = cashOrder ? cashOrder.total - Number(cashOrder.service_charge ?? 0) : 0;

  const alertControl = (
    <Switch
      label={t.alerts}
      description={t.alertsHelp}
      checked={alertsEnabled}
      disabled={pending}
      onChange={(event) => toggleAlerts(event.target.checked)}
      className="max-w-sm"
    />
  );

  if (!sessions.length) {
    return (
      <section className="mb-8">
        <div className="mb-4 flex flex-col items-start justify-between gap-3 lg:flex-row lg:items-end">
          <div><h2 className="font-display text-xl font-bold">{t.title}</h2><p className="text-sm text-text-secondary">{t.help}</p></div>
          <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:items-center">{alertControl}<a href="/m/tables/print" target="_blank" className={buttonClasses({ variant: "outline", size: "sm" })}>{t.print}</a></div>
        </div>
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
      <div className="mb-4 flex flex-col items-start justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 className="font-display text-xl font-bold">{t.title}</h2>
          <p className="text-sm text-text-secondary">{t.help}</p>
        </div>
        <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:items-center">
          {alertControl}
          <a href="/m/tables/print" target="_blank" className={buttonClasses({ variant: "outline", size: "sm" })}>{t.print}</a>
        </div>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-lg border border-border bg-surface p-2 lg:sticky lg:top-4 lg:self-start" aria-label={t.title}>
          <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {orderedSessions.map((session) => {
              const table = Array.isArray(session.restaurant_tables) ? session.restaurant_tables[0] : session.restaurant_tables;
              const waiting = session.dining_guests.filter((guest) => guest.status === "pending").length + session.dining_rounds.filter((round) => round.status === "pending").length;
              return <button key={session.id} type="button" onClick={() => { setSelectedSessionId(session.id); setSelectedItems([]); setMobileTab("commands"); }} className={`min-w-32 rounded-md p-3 text-left transition-colors lg:w-full ${selectedSession?.id === session.id ? "bg-primary text-white" : "hover:bg-surface-2"}`}>
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">{t.table} {table?.number}{waiting > 0 && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-warning text-xs text-black">{waiting}</span>}</span>
                <span className="mt-1 block truncate text-xs opacity-80">{session.dining_guests.filter((guest) => guest.status === "approved").map((guest) => guest.display_name).join(", ") || t.access}</span>
              </button>;
            })}
          </div>
          {selectedSession && <div className="mt-2 hidden border-t border-border pt-2 lg:block"><p className="px-2 text-xs font-semibold uppercase text-text-secondary">{t.people}</p>{selectedSession.dining_guests.filter((guest) => guest.status === "approved").map((guest) => <button key={guest.id} type="button" onClick={() => { setReplyGuests((value) => ({ ...value, [selectedSession.id]: guest.id })); setMobileTab("messages"); }} className="block w-full truncate rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2">{guest.display_name}</button>)}</div>}
        </aside>
        <div className="min-w-0">
          <div className="mb-3 grid grid-cols-2 gap-2 lg:hidden" role="tablist" aria-label={t.title}>
            <button type="button" role="tab" aria-selected={mobileTab === "commands"} onClick={() => setMobileTab("commands")} className={`rounded-full px-3 py-2 text-sm font-semibold ${mobileTab === "commands" ? "bg-primary text-white" : "bg-surface-2"}`}>{t.commands}</button>
            <button type="button" role="tab" aria-selected={mobileTab === "messages"} onClick={() => setMobileTab("messages")} className={`rounded-full px-3 py-2 text-sm font-semibold ${mobileTab === "messages" ? "bg-primary text-white" : "bg-surface-2"}`}>{t.conversation}</button>
          </div>
        {[selectedSession].filter((session): session is DiningFloorSession => Boolean(session)).map((session) => {
          const table = Array.isArray(session.restaurant_tables) ? session.restaurant_tables[0] : session.restaurant_tables;
          const order = Array.isArray(session.orders) ? session.orders[0] : session.orders;
          const guests = session.dining_guests ?? [];
          const rounds = session.dining_rounds ?? [];
          const messages = session.dining_messages ?? [];
          const approvedGuests = guests.filter((guest) => guest.status === "approved");
          const replyGuestId = replyGuests[session.id] ?? approvedGuests[0]?.id ?? "";
          const guestMessages = messages.filter((message) => !message.guest_id || message.guest_id === replyGuestId);
          const pendingItems = rounds.flatMap((round) => round.dining_round_items.filter((item) => item.status === "pending"));
          const activeSelection = selectedItems.filter((id) => pendingItems.some((item) => item.id === id));
          return (
            <article key={session.id} className={`min-w-0 overflow-hidden rounded-lg border bg-surface ${session.id === focusSessionId ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                <div>
                  <h3 className="font-display text-lg font-bold">{t.table} {table?.number}</h3>
                  <p className="text-xs text-text-secondary">{guests.length} {t.devices}</p>
                </div>
                <Badge tone={session.status === "payment_requested" ? "warning" : session.status === "open" ? "success" : "neutral"}>{session.status.replaceAll("_", " ")}</Badge>
              </header>
              <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-2">
                <div className={`min-w-0 space-y-5 ${mobileTab === "commands" ? "block" : "hidden"} lg:block`}>
                <div>
                  <h4 className="mb-2 text-sm font-semibold">{t.access}</h4>
                  <ul className="space-y-2">
                    {guests.map((guest) => (
                      <li key={guest.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface-2 p-3">
                        <span className="min-w-24 flex-1 truncate text-sm font-medium">{guest.display_name}</span>
                        <Badge tone={guest.status === "approved" ? "success" : guest.status === "pending" ? "warning" : "neutral"}>{guest.status}</Badge>
                        {guest.status === "pending" && <>
                          <Button size="icon-sm" disabled={pending || session.status === "payment_requested"} aria-label={t.approve} onClick={() => run(() => decideDiningGuest(guest.id, true), t.approved)}><Check className="size-4" /></Button>
                          <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={t.reject} onClick={() => run(() => decideDiningGuest(guest.id, false), t.rejected)}><X className="size-4" /></Button>
                        </>}
                        {guest.status === "pending" && session.status === "payment_requested" && <p className="w-full text-xs text-warning">{t.settlingAccess}</p>}
                      </li>
                    ))}
                  </ul>
                </div>

                {pendingItems.length > 0 && <div className="rounded-md border border-border bg-surface-2 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={activeSelection.length === pendingItems.length} onChange={(event) => setSelectedItems(event.target.checked ? pendingItems.map((item) => item.id) : [])} />{t.selectAll}</label>
                  {activeSelection.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs text-text-secondary">{activeSelection.length} {t.selected}</span><Button size="sm" disabled={pending} onClick={() => runBulk(activeSelection, true)}>{t.acceptSelected}</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => { setBulkReason(""); setBulkRejectOpen(true); }}>{t.rejectSelected}</Button></div>}
                </div>}
                {rounds.filter((round) => round.status === "pending").map((round) => (
                  <div key={round.id} className="rounded-md border border-warning/30 bg-warning-light p-3">
                    <p className="font-semibold">{t.newOrder} · {guests.find((guest) => guest.id === round.guest_id)?.display_name ?? t.guest}</p>
                    {round.notes && <p className="mt-1 break-words text-xs italic">{round.notes}</p>}
                    <ul className="mt-3 space-y-2">
                      {round.dining_round_items.map((item) => (
                        <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface p-3">
                          {item.status === "pending" && <input type="checkbox" aria-label={`${t.selectAll}: ${item.name}`} checked={activeSelection.includes(item.id)} onChange={(event) => setSelectedItems((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} />}
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold">{item.quantity}× {item.name}</p>
                            {item.options_label && <p className="text-xs text-text-secondary">{item.options_label}</p>}
                            <p className="text-xs text-text-secondary">{formatMoney(item.unit_price * item.quantity)}</p>
                            {item.rejection_reason && <p className="mt-1 text-xs text-error">{item.rejection_reason}</p>}
                          </div>
                          {item.status === "pending" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" disabled={pending} onClick={() => run(() => decideDiningItem(item.id, true), t.dishAccepted)}>{t.accept}</Button>
                              <Button variant="outline" size="sm" disabled={pending} onClick={() => { setRejectItem({ id: item.id, name: item.name }); setRejectReason(""); }}>{t.rejectDish}</Button>
                            </div>
                          ) : <Badge tone={item.status === "accepted" ? "success" : "error"}>{item.status === "accepted" ? t.accept : t.reject}</Badge>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                </div>
                <div className={`min-w-0 ${mobileTab === "messages" ? "block" : "hidden"} lg:block`}>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-4" />{t.messages}</h4>
                  {approvedGuests.length > 0 && (
                    <label className="mb-2 block text-xs font-semibold">
                      {t.chooseGuest}
                      <select className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        value={replyGuestId}
                        onChange={(event) => setReplyGuests((value) => ({ ...value, [session.id]: event.target.value }))}>
                        {approvedGuests.map((guest) => <option key={guest.id} value={guest.id}>{guest.display_name}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="flex h-80 flex-col gap-2 overflow-y-auto rounded-md bg-surface-2 p-3" aria-live="polite">
                    {guestMessages.slice(-40).map((message) => <div key={message.id} className={`max-w-[85%] break-words rounded-lg px-3 py-2 text-sm ${message.sender_kind === "guest" ? "self-start bg-surface" : "self-end bg-primary/10"}`}><p className="mb-1 text-xs font-semibold">{message.sender_kind === "guest" ? guests.find((guest) => guest.id === message.guest_id)?.display_name ?? t.guest : t.staff}</p><p>{message.body}</p><time className="mt-1 block text-right text-[11px] text-text-secondary">{new Date(message.created_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></div>)}
                    {!guestMessages.length && <p className="text-sm text-text-light">{t.noMessages}</p>}
                  </div>
                  <div className="mt-2 flex min-w-0 gap-2">
                    <Input className="min-w-0" value={text[session.id] ?? ""} onChange={(event) => setText((value) => ({ ...value, [session.id]: event.target.value }))} placeholder={t.reply} />
                    <Button size="icon" aria-label={t.sent} disabled={pending || !replyGuestId || !(text[session.id] ?? "").trim()} onClick={() => {
                      const body = text[session.id] ?? "";
                      start(async () => {
                        const result = await sendStaffDiningMessage(session.id, replyGuestId, body);
                        toast(result.ok ? t.sent : localizeActionError(result.error, locale, t.error), result.ok ? "success" : "error");
                        if (result.ok) { setText((value) => ({ ...value, [session.id]: "" })); router.refresh(); }
                      });
                    }}><Send className="size-4" /></Button>
                  </div>
                </div>

                {order && (
                  <div className="flex flex-col items-stretch gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center">
                    <div className="mr-auto">
                      <p className="text-xs text-text-secondary">{order.reference}</p>
                      <p className="font-display text-xl font-bold">{formatMoney(order.total)}</p>
                    </div>
                    {canCollect && !order.is_paid && session.status === "open" && <Button className="whitespace-normal" variant="outline" disabled={pending} onClick={() => run(() => requestDiningPayment(session.id), t.requested)}><CreditCard className="size-4 shrink-0" />{t.requestPayment}</Button>}
                    {canCollect && !order.is_paid && <Button className="whitespace-normal" disabled={pending} onClick={() => { setCashSessionId(session.id); setCashAcknowledged(false); }}><ReceiptText className="size-4 shrink-0" />{t.cash}</Button>}
                    {session.status === "payment_requested" && <span className="flex items-center gap-1 text-sm text-warning"><Clock3 className="size-4" />{t.waiting}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        </div>
      </div>
      <Dialog open={cashSessionId !== null} onClose={() => setCashSessionId(null)} title={t.cashTitle} size="md" footer={<>
        <Button variant="outline" disabled={pending} onClick={() => setCashSessionId(null)}>{t.cancel}</Button>
        <Button disabled={pending || !cashAcknowledged || !cashOrder || cashAmount <= 0 || !cashOrder.order_items?.length || !cashGuests.length} loading={pending} onClick={() => {
          if (!cashSession || !cashOrder) return;
          run(() => closeDiningCash({ sessionId: cashSession.id, orderId: cashOrder.id, amount: cashAmount, itemIds: cashOrder.order_items.map((item) => item.id), guestIds: cashGuests.map((guest) => guest.id), confirmAll: true }), t.cashDone);
          setCashSessionId(null);
        }}>{t.cash}</Button>
      </>}>
        <p className="mb-3 rounded-md bg-warning-light p-3 text-sm">{t.cashWarning}</p>
        <p className="text-sm font-semibold">{t.people}</p>
        <ul className="mb-4 list-inside list-disc text-sm">{cashGuests.map((guest) => <li key={guest.id}>{guest.display_name}</li>)}</ul>
        <div className="max-h-48 overflow-y-auto rounded-md border border-border p-3"><p className="mb-2 text-sm font-semibold">{cashOrder?.reference}</p>{cashOrder?.order_items?.map((item) => <div key={item.id} className="flex justify-between gap-3 py-1 text-sm"><span className="min-w-0 break-words">{item.quantity}× {item.name}</span><span className="shrink-0">{formatMoney(item.quantity * item.unit_price)}</span></div>)}</div>
        <p className="mt-3 flex justify-between font-semibold"><span>{t.cashAmount}</span><span>{formatMoney(cashAmount)}</span></p>
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={cashAcknowledged} onChange={(event) => setCashAcknowledged(event.target.checked)} /><span>{t.cashConfirm}</span></label>
      </Dialog>
      <Dialog open={bulkRejectOpen} onClose={() => setBulkRejectOpen(false)} title={t.bulkRejectTitle} size="sm" footer={<>
        <Button variant="outline" disabled={pending} onClick={() => setBulkRejectOpen(false)}>{t.cancel}</Button>
        <Button variant="danger" disabled={pending || bulkReason.trim().length < 5} loading={pending} onClick={() => {
          const session = orderedSessions.find((entry) => entry.id === selectedSessionId) ?? orderedSessions[0];
          const pendingIds = session?.dining_rounds.flatMap((round) => round.dining_round_items.filter((item) => item.status === "pending").map((item) => item.id)) ?? [];
          runBulk(selectedItems.filter((id) => pendingIds.includes(id)), false, bulkReason);
        }}>{t.rejectSelected}</Button>
      </>}>
        <p className="mb-3 text-sm text-text-secondary">{selectedItems.length} {t.selected}. {t.rejectHint}</p>
        <label className="block text-sm font-medium">{t.rejectReason}<Input className="mt-2" value={bulkReason} maxLength={240} onChange={(event) => setBulkReason(event.target.value)} /></label>
      </Dialog>
      <Dialog
        open={rejectItem !== null}
        onClose={() => setRejectItem(null)}
        title={t.rejectTitle}
        size="sm"
        footer={<>
          <Button variant="outline" disabled={pending} onClick={() => setRejectItem(null)}>{t.cancel}</Button>
          <Button variant="danger" disabled={pending || rejectReason.trim().length < 5} loading={pending} onClick={rejectSelectedItem}>{t.rejectDish}</Button>
        </>}
      >
        <p className="mb-3 text-sm font-semibold">{rejectItem?.name}</p>
        <label className="block text-sm font-medium">{t.rejectReason}
          <Input className="mt-2" value={rejectReason} maxLength={240} onChange={(event) => setRejectReason(event.target.value)} />
        </label>
        <p className="mt-2 text-xs text-text-secondary">{t.rejectHint}</p>
      </Dialog>
    </section>
  );
}
