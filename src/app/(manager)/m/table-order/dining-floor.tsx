"use client";

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
  requestDiningPayment,
  sendStaffDiningMessage,
  setMyDiningNotifications,
} from "@/lib/data/dining-actions";
import { useRouter } from "next/navigation";

type Guest = { id: string; display_name: string; status: string; created_at: string };
type Item = { id: string; name: string; quantity: number; unit_price: number; options_label: string | null; status: string; rejection_reason: string | null };
type Round = { id: string; guest_id: string; status: string; subtotal: number; notes: string | null; created_at: string; dining_round_items: Item[] };
type Msg = { id: string; guest_id: string | null; sender_kind: string; kind: string; body: string; created_at: string };
export type DiningFloorSession = {
  id: string;
  status: string;
  order_id: string | null;
  restaurant_tables: { id: string; number: string; public_token: string } | { id: string; number: string; public_token: string }[];
  dining_guests: Guest[];
  dining_rounds: Round[];
  dining_messages: Msg[];
  orders: { id: string; reference: string; status: string; total: number; is_paid: boolean; payment_method: string } | { id: string; reference: string; status: string; total: number; is_paid: boolean; payment_method: string }[] | null;
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
    waiting: "Waiting for payment",
    alerts: "Table alerts for me",
    alertsHelp: "Access requests, food orders and calls. Push requires notifications to be enabled on this device.",
    alertsSaved: "Table alert preference saved",
    alertsFailed: "Could not save the table alert preference",
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
    waiting: "En attente du paiement",
    alerts: "Mes alertes de table",
    alertsHelp: "Demandes d’accès, commandes et appels. Le push doit être activé sur cet appareil.",
    alertsSaved: "Préférence d’alerte enregistrée",
    alertsFailed: "Impossible d’enregistrer la préférence d’alerte",
  },
} as const;

export function DiningFloor({ sessions, focusSessionId, canFinance, notificationsEnabled }: { sessions: DiningFloorSession[]; focusSessionId?: string; canFinance: boolean; notificationsEnabled: boolean }) {
  const { toast } = useToast();
  const { locale } = useLocale();
  const t = copy[locale];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState<Record<string, string>>({});
  const [replyGuests, setReplyGuests] = useState<Record<string, string>>({});
  const [rejectItem, setRejectItem] = useState<{ id: string; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [alertsEnabled, setAlertsEnabled] = useState(notificationsEnabled);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [router]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const result = await fn();
      toast(result.ok ? success : result.error ?? "Error", result.ok ? "success" : "error");
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
      toast(result.ok ? t.dishRejected : result.error ?? "Error", result.ok ? "success" : "error");
      if (result.ok) {
        setRejectItem(null);
        setRejectReason("");
        router.refresh();
      }
    });
  }

  function toggleAlerts(enabled: boolean) {
    const previous = alertsEnabled;
    setAlertsEnabled(enabled);
    start(async () => {
      const result = await setMyDiningNotifications(enabled);
      if (!result.ok) setAlertsEnabled(previous);
      toast(result.ok ? t.alertsSaved : result.error ?? t.alertsFailed, result.ok ? "success" : "error");
    });
  }

  const orderedSessions = focusSessionId
    ? [...sessions].sort((a, b) => Number(b.id === focusSessionId) - Number(a.id === focusSessionId))
    : sessions;

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
      <div className="grid gap-4 xl:grid-cols-2">
        {orderedSessions.map((session) => {
          const table = Array.isArray(session.restaurant_tables) ? session.restaurant_tables[0] : session.restaurant_tables;
          const order = Array.isArray(session.orders) ? session.orders[0] : session.orders;
          const guests = session.dining_guests ?? [];
          const rounds = session.dining_rounds ?? [];
          const messages = session.dining_messages ?? [];
          const approvedGuests = guests.filter((guest) => guest.status === "approved");
          const replyGuestId = replyGuests[session.id] ?? approvedGuests[0]?.id ?? "";
          const guestMessages = messages.filter((message) => !message.guest_id || message.guest_id === replyGuestId);
          return (
            <article key={session.id} className={`min-w-0 overflow-hidden rounded-lg border bg-surface ${session.id === focusSessionId ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                <div>
                  <h3 className="font-display text-lg font-bold">{t.table} {table?.number}</h3>
                  <p className="text-xs text-text-secondary">{guests.length} {t.devices}</p>
                </div>
                <Badge tone={session.status === "payment_requested" ? "warning" : session.status === "open" ? "success" : "neutral"}>{session.status.replaceAll("_", " ")}</Badge>
              </header>
              <div className="space-y-5 p-4">
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

                {rounds.filter((round) => round.status === "pending").map((round) => (
                  <div key={round.id} className="rounded-md border border-warning/30 bg-warning-light p-3">
                    <p className="font-semibold">{t.newOrder} · {guests.find((guest) => guest.id === round.guest_id)?.display_name ?? t.guest}</p>
                    {round.notes && <p className="mt-1 break-words text-xs italic">{round.notes}</p>}
                    <ul className="mt-3 space-y-2">
                      {round.dining_round_items.map((item) => (
                        <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-surface p-3">
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

                <div>
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
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-md bg-surface-2 p-3">
                    {guestMessages.slice(-8).map((message) => <p key={message.id} className="break-words text-sm"><strong>{message.sender_kind === "guest" ? guests.find((guest) => guest.id === message.guest_id)?.display_name ?? t.guest : t.staff}:</strong> {message.body}</p>)}
                    {!guestMessages.length && <p className="text-sm text-text-light">{t.noMessages}</p>}
                  </div>
                  <div className="mt-2 flex min-w-0 gap-2">
                    <Input className="min-w-0" value={text[session.id] ?? ""} onChange={(event) => setText((value) => ({ ...value, [session.id]: event.target.value }))} placeholder={t.reply} />
                    <Button size="icon" aria-label={t.sent} disabled={pending || !replyGuestId || !(text[session.id] ?? "").trim()} onClick={() => {
                      const body = text[session.id] ?? "";
                      start(async () => {
                        const result = await sendStaffDiningMessage(session.id, replyGuestId, body);
                        toast(result.ok ? t.sent : result.error ?? "Error", result.ok ? "success" : "error");
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
                    {canFinance && !order.is_paid && session.status === "open" && <Button className="whitespace-normal" variant="outline" disabled={pending} onClick={() => run(() => requestDiningPayment(session.id), t.requested)}><CreditCard className="size-4 shrink-0" />{t.requestPayment}</Button>}
                    {canFinance && !order.is_paid && <Button className="whitespace-normal" disabled={pending} onClick={() => run(() => closeDiningCash(session.id), t.cashDone)}><ReceiptText className="size-4 shrink-0" />{t.cash}</Button>}
                    {session.status === "payment_requested" && <span className="flex items-center gap-1 text-sm text-warning"><Clock3 className="size-4" />{t.waiting}</span>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
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
