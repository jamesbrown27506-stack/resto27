"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bell, Check, Clock3, CreditCard, Droplets, Plus, ReceiptText, Send, ShoppingBag, UtensilsCrossed, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PaymentPendingView } from "@/components/payment/payment-pending";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import {
  requestTableAccess, getGuestDiningState, submitGuestRound, sendGuestDiningMessage,
  payDiningBill, checkDiningPayment, requestGuestDiningPayment,
} from "@/lib/data/dining-actions";
import { nativePlatform } from "@/lib/capacitor/platform";
import { syncGuestPush } from "@/lib/dining/guest-push-client";
import { playNotificationSound, unlockNotificationSound } from "@/lib/notifications/sound-player";
import type { PaymentInstruction } from "@/lib/payments/camerpay/notification";

type Landing = NonNullable<Awaited<ReturnType<typeof import("@/lib/data/dining-actions").getTableLanding>>>;
type State = NonNullable<Awaited<ReturnType<typeof getGuestDiningState>>>;
type Line = { id: string; name: string; price: number; quantity: number; optionIds: string[] };

function GuestDishPhoto({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2">
    {src && !failed
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      : <UtensilsCrossed className="size-7 text-text-light" />}
  </div>;
}

export function GuestTableClient({ landing }: { landing: Landing }) {
  const { locale } = useLocale();
  const en = locale === "en";
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [attempt, setAttempt] = useState<string | null>(null);
  const [instruction, setInstruction] = useState<PaymentInstruction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(landing.categories[0]?.id ?? "");
  const [pushStatus, setPushStatus] = useState<"idle" | "enabled" | "unavailable">("idle");
  const seenMessages = useRef<Set<string> | null>(null);
  const lastNativePushAt = useRef(0);

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
    const timer = window.setTimeout(() => setToken(localStorage.getItem(`resto237-table-${landing.table.token}`)), 0);
    return () => window.clearTimeout(timer);
  }, [landing.table.token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const refresh = () => getGuestDiningState(token).then((next) => {
      if (!alive) return;
      if (!next) {
        setError(en ? "This visit is no longer available. Request access again." : "Cette visite n’est plus disponible. Demandez un nouvel accès.");
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
      if (alive) setError(en ? "Connection lost. We will try again." : "Connexion perdue. Nouvelle tentative en cours.");
    });
    void refresh();
    const timer = window.setInterval(refresh, 5000);
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
      window.clearInterval(timer);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", onPush);
      window.removeEventListener("resto237:native-notification", onPush);
    };
  }, [token, en, landing.table.token]);

  useEffect(() => {
    if (!token || !attempt) return;
    const timer = window.setInterval(() => void checkDiningPayment(token, attempt).then((result) => {
      if (result.instruction) setInstruction(result.instruction);
      if (result.status === "succeeded") {
        setAttempt(null);
        void getGuestDiningState(token).then(setState);
      } else if (result.status === "failed") {
        setAttempt(null);
        setError(en ? "Payment was not confirmed. You can try again." : "Le paiement n’a pas été confirmé. Vous pouvez réessayer.");
      }
    }), 5000);
    return () => window.clearInterval(timer);
  }, [token, attempt, en]);

  const groups = useMemo(() => landing.categories
    .map((category) => ({ category, items: landing.items.filter((item) => item.category_id === category.id) }))
    .filter((group) => group.items.length > 0), [landing]);
  const currentGroup = groups.find((group) => group.category.id === selectedCategory) ?? groups[0];
  const cartTotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const acceptedSubtotal = Number(state?.order?.subtotal ?? 0);
  const onlineFee = Math.round(acceptedSubtotal * landing.serviceChargePercent / 100);
  const hasPendingDishes = state?.rounds.some((round) =>
    round.dining_round_items.some((item) => item.status === "pending")) ?? false;

  function resetVisit() {
    localStorage.removeItem(`resto237-table-${landing.table.token}`);
    setToken(null);
    setState(null);
    setError(null);
    setNotice(null);
    setPushStatus("idle");
    seenMessages.current = null;
  }

  async function enableAlerts(raw: string) {
    unlockNotificationSound();
    const result = await syncGuestPush(raw, true);
    setPushStatus(result);
    if (result === "enabled") {
      setNotice(en ? "Table alerts are enabled on this device." : "Les alertes de table sont activées sur cet appareil.");
      void playNotificationSound();
    }
  }

  function join() {
    start(async () => {
      setError(null);
      const result = await requestTableAccess(landing.table.token, name, locale);
      if (!result.ok || !result.guestToken) {
        setError(result.error ?? (en ? "Could not request access." : "Demande impossible."));
        return;
      }
      localStorage.setItem(`resto237-table-${landing.table.token}`, result.guestToken);
      setToken(result.guestToken);
      setState(await getGuestDiningState(result.guestToken));
    });
  }

  function add(item: Landing["items"][number]) {
    const defaults = landing.groups
      .filter((group) => group.menu_item_id === item.id && group.is_required && group.max_select === 1)
      .map((group) => landing.options.find((option) => option.group_id === group.id && option.is_available))
      .filter(Boolean) as Landing["options"];
    const optionIds = defaults.map((option) => option.id);
    const price = Number(item.price) + defaults.reduce((sum, option) => sum + Number(option.price_delta), 0);
    setCart((current) => {
      const old = current.find((line) => line.id === item.id);
      return old
        ? current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { id: item.id, name: item.name, price, quantity: 1, optionIds }];
    });
  }

  function submit() {
    if (!token) return;
    start(async () => {
      setError(null);
      const result = await submitGuestRound(token, {
        lines: cart.map((line) => ({ menuItemId: line.id, quantity: line.quantity, optionIds: line.optionIds })),
        notes,
      });
      if (!result.ok) { setError(result.error ?? "Not sent"); return; }
      setCart([]);
      setNotes("");
      setNotice(en ? "Your dishes were sent for review." : "Vos plats ont été envoyés pour validation.");
      setState(await getGuestDiningState(token));
    });
  }

  function quick(kind: "call_waiter" | "water" | "bill" | "help" | "message", body?: string) {
    if (!token) return;
    start(async () => {
      const result = await sendGuestDiningMessage(token, kind, body);
      if (!result.ok) { setError(result.error ?? "Not sent"); return; }
      setMessage("");
      setNotice(en ? "The restaurant has been notified." : "Le restaurant a été prévenu.");
      setState(await getGuestDiningState(token));
    });
  }

  function chooseOnline() {
    if (!token) return;
    start(async () => {
      const result = await requestGuestDiningPayment(token);
      if (!result.ok) { setError(result.error ?? "Could not prepare payment."); return; }
      setBillOpen(false);
      setState(await getGuestDiningState(token));
      setNotice(en ? "Online payment is ready. Enter your Mobile Money number." : "Paiement en ligne prêt. Entrez votre numéro Mobile Money.");
    });
  }

  function pay() {
    if (!token) return;
    start(async () => {
      const result = await payDiningBill(token, phone);
      if (!result.ok) { setError(result.error ?? "Payment failed"); return; }
      if (result.status === "pending" && result.attemptId) {
        setAttempt(result.attemptId);
        setInstruction(result.instruction ?? null);
      } else setState(await getGuestDiningState(token));
    });
  }

  const alertsControl = token && (pushStatus === "enabled" ? (
    <span className="flex items-center gap-2 text-sm text-success"><Bell className="size-4" />{en ? "Table alerts enabled" : "Alertes de table activées"}</span>
  ) : (
    <Button variant="outline" size="sm" onClick={() => void enableAlerts(token)}>
      <Bell className="size-4" />
      {en ? "Enable table alerts" : "Activer les alertes"}
    </Button>
  ));

  if (!token) return (
    <main className="mx-auto min-h-[100dvh] max-w-lg px-4 py-10">
      <p className="text-sm font-semibold text-primary">{landing.restaurant.name}</p>
      <h1 className="mt-2 font-display text-3xl font-bold">{en ? "Welcome to table" : "Bienvenue à la table"} {landing.table.number}</h1>
      <p className="mt-3 text-text-secondary">{en
        ? "Enter a name so staff can identify you. A waiter will approve this device before you can order or send messages."
        : "Entrez un nom pour que le personnel puisse vous identifier. Un serveur validera cet appareil avant toute commande ou message."}</p>
      <div className="mt-8 rounded-lg border border-border bg-surface p-5">
        <Field label={en ? "First name or nickname" : "Prénom ou surnom"} htmlFor="guest-name">
          <Input id="guest-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={en ? "Example: Emmanuel" : "Exemple : Emmanuel"} />
        </Field>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <Button fullWidth size="lg" className="mt-5" disabled={pending || name.trim().length < 2} loading={pending} onClick={join}>
          {en ? "Request table access" : "Demander l’accès à la table"}
        </Button>
      </div>
    </main>
  );

  if (!state && error) return (
    <main className="mx-auto grid min-h-[100dvh] max-w-lg place-items-center px-4 text-center">
      <div><p className="text-text-secondary">{error}</p><Button className="mt-4" onClick={resetVisit}>{en ? "Request access again" : "Demander un nouvel accès"}</Button></div>
    </main>
  );

  if (state?.guest.status === "pending" && state.session.status === "payment_requested") return (
    <main className="mx-auto grid min-h-[100dvh] max-w-lg place-items-center px-4 text-center">
      <div><Clock3 className="mx-auto size-10 text-warning" />
        <h1 className="mt-4 font-display text-2xl font-bold">{en ? "This table is settling its bill" : "Cette table règle son addition"}</h1>
        <p className="mt-2 text-text-secondary">{en ? "Ask staff to close the current visit, then scan the QR code again." : "Demandez au personnel de clôturer la visite, puis scannez de nouveau le QR code."}</p>
        <Button className="mt-4" onClick={resetVisit}>{en ? "Scan again later" : "Réessayer plus tard"}</Button>
      </div>
    </main>
  );

  if (!state || state.guest.status === "pending") return (
    <main className="mx-auto grid min-h-[100dvh] max-w-lg place-items-center px-4">
      <div className="text-center">
        <Clock3 className="mx-auto size-10 text-primary" />
        <h1 className="mt-4 font-display text-2xl font-bold">{en ? "Waiting for a waiter" : "En attente d’un serveur"}</h1>
        <p className="mt-2 text-text-secondary">{en
          ? `Your request for table ${landing.table.number} was sent. Staff must approve this device.`
          : `Votre demande pour la table ${landing.table.number} a été envoyée. Le personnel doit valider cet appareil.`}</p>
        <div className="mt-5 flex justify-center">{alertsControl}</div>
        {pushStatus === "unavailable" && <p className="mt-2 text-xs text-text-secondary">{en ? "Keep this page open for updates." : "Gardez cette page ouverte pour les nouvelles."}</p>}
      </div>
    </main>
  );

  if (state.guest.status !== "approved" || state.session.status === "closed") return (
    <main className="mx-auto grid min-h-[100dvh] max-w-lg place-items-center px-4 text-center">
      <div><Check className="mx-auto size-10 text-primary" />
        <h1 className="mt-4 text-2xl font-bold">{state.guest.status === "rejected"
          ? (en ? "Access was declined" : "Accès refusé")
          : (en ? "This table visit is closed" : "Cette visite est terminée")}</h1>
        {state.order?.is_paid && <p className="mt-3 font-semibold text-success">{en ? "Payment recorded" : "Paiement enregistré"} · {formatMoney(state.order.total)}</p>}
        {state.guest.status === "rejected" && <Button className="mt-4" onClick={resetVisit}>{en ? "Request access again" : "Demander un nouvel accès"}</Button>}
      </div>
    </main>
  );

  if (attempt) return (
    <main className="mx-auto min-h-[100dvh] max-w-lg px-4 py-8">
      <PaymentPendingView
        body={en ? "Confirm the request on your phone." : "Confirmez la demande sur votre téléphone."}
        hint={en ? "This page checks CamerPay automatically." : "Cette page vérifie CamerPay automatiquement."}
        amountLabel={en ? "Total" : "Total"} amount={formatMoney(state.order?.total ?? 0)}
        referenceLabel={en ? "Reference" : "Référence"} reference={state.order?.reference ?? "—"}
        phoneLabel={en ? "Mobile Money number" : "Numéro Mobile Money"} phone={phone}
        gatewayLabel={en ? "Secure payment" : "Paiement sécurisé"} instruction={instruction}
      />
    </main>
  );

  const paymentRequested = state.session.status === "payment_requested" && !state.order?.is_paid;
  const billItems = state.order?.order_items ?? [];

  return (
    <main className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-6 pb-32">
      {notice && (
        <div role="status" className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-lg border border-primary/30 bg-surface p-4 shadow-lg">
          <Bell className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm leading-relaxed">{notice}</p>
          <button type="button" className="rounded-full p-1" aria-label={en ? "Dismiss" : "Fermer"} onClick={() => setNotice(null)}><X className="size-4" /></button>
        </div>
      )}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div><p className="text-sm font-semibold text-primary">{landing.restaurant.name}</p>
          <h1 className="font-display text-2xl font-bold">{en ? "Table" : "Table"} {landing.table.number}</h1>
          <p className="text-sm text-text-secondary">{state.guest.name}</p></div>
        {alertsControl}
      </header>
      {pushStatus === "unavailable" && <p className="mt-2 text-xs text-text-secondary">{en ? "Keep this page open to receive table updates." : "Gardez cette page ouverte pour recevoir les nouvelles de la table."}</p>}

      {paymentRequested && (
        <section className="mt-5 rounded-lg border border-warning/30 bg-warning-light p-5">
          <h2 className="font-display text-xl font-bold">{en ? "Online payment is ready" : "Paiement en ligne prêt"}</h2>
          <p className="mt-2 text-sm text-text-secondary">{en ? "Review your bill, then start Mobile Money from your own phone." : "Vérifiez l’addition, puis lancez Mobile Money depuis votre téléphone."}</p>
          <p className="mt-3 text-sm">{en ? "Dishes" : "Plats"}: {formatMoney(state.order?.subtotal ?? 0)} · {en ? "Online fee" : "Frais en ligne"}: {formatMoney(state.order?.service_charge ?? 0)}</p>
          <p className="mt-1 text-2xl font-bold text-primary">{formatMoney(state.order?.total ?? 0)}</p>
          <Field label={en ? "Mobile Money number" : "Numéro Mobile Money"} htmlFor="pay-phone">
            <Input id="pay-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6XXXXXXXX" />
          </Field>
          <Button className="mt-4" disabled={pending || phone.length < 9} loading={pending} onClick={pay}>
            <WalletCards className="size-4" />{en ? "Pay the bill" : "Payer l’addition"}
          </Button>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-xl font-bold">{en ? "At your table" : "À votre table"}</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="outline" onClick={() => setBillOpen((value) => !value)}><ReceiptText className="size-4" />{en ? "My bill" : "Mon addition"}</Button>
          <Button variant="outline" onClick={() => quick("call_waiter")}><Bell className="size-4" />{en ? "Call waiter" : "Appeler"}</Button>
          <Button variant="outline" onClick={() => quick("water")}><Droplets className="size-4" />{en ? "Water" : "Eau"}</Button>
          <Button variant="outline" onClick={() => quick("help")}><UtensilsCrossed className="size-4" />{en ? "Help" : "Aide"}</Button>
        </div>
      </section>

      {billOpen && (
        <section className="mt-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-bold">{en ? "Your bill so far" : "Votre addition actuelle"}</h2>
          {billItems.length ? (
            <ul className="mt-3 divide-y divide-border">{billItems.map((item, index) => (
              <li key={index} className="flex justify-between gap-3 py-2 text-sm">
                <span>{item.quantity}× {item.name}{item.options_label ? ` · ${item.options_label}` : ""}</span>
                <span className="shrink-0 font-semibold">{formatMoney(item.unit_price * item.quantity)}</span>
              </li>
            ))}</ul>
          ) : <p className="mt-3 text-sm text-text-secondary">{en ? "No dishes have been accepted yet." : "Aucun plat n’a encore été accepté."}</p>}
          <div className="mt-3 border-t border-border pt-3">
            <p className="flex justify-between font-semibold"><span>{en ? "Dishes consumed" : "Plats consommés"}</span><span>{formatMoney(acceptedSubtotal)}</span></p>
            <p className="mt-2 flex justify-between text-sm text-text-secondary"><span>{en ? `Online payment fee (${landing.serviceChargePercent}%)` : `Frais de paiement en ligne (${landing.serviceChargePercent} %)`}</span><span>{formatMoney(onlineFee)}</span></p>
            <p className="mt-2 flex justify-between font-bold text-primary"><span>{en ? "Total online" : "Total en ligne"}</span><span>{formatMoney(acceptedSubtotal + onlineFee)}</span></p>
            <p className="mt-2 text-xs text-text-secondary">{en ? "Paying at the table does not add the online payment fee." : "Le paiement sur place n’ajoute pas de frais de paiement en ligne."}</p>
          </div>
          {hasPendingDishes && <p className="mt-3 rounded-md bg-warning-light p-3 text-sm text-warning">{en ? "Wait for the restaurant to decide the remaining dishes before settling the bill." : "Attendez la réponse du restaurant pour les autres plats avant de régler."}</p>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" disabled={pending || !billItems.length || hasPendingDishes} onClick={() => { quick("bill"); setBillOpen(false); }}>
              <Bell className="size-4" />{en ? "Pay on site — call staff" : "Payer sur place — appeler"}
            </Button>
            <Button disabled={pending || !billItems.length || hasPendingDishes || paymentRequested} loading={pending} onClick={chooseOnline}>
              <CreditCard className="size-4" />{en ? "Pay online" : "Payer en ligne"}
            </Button>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-xl font-bold">{en ? "Messages & updates" : "Messages et nouvelles"}</h2>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border bg-surface p-3" aria-live="polite">
          {state.messages.length ? state.messages.map((entry) => (
            <div key={entry.id} className={`rounded-md px-3 py-2 text-sm ${entry.sender_kind === "guest" ? "ml-8 bg-primary-light" : "mr-8 bg-surface-2"}`}>
              <p className="text-xs font-semibold text-text-secondary">{entry.sender_kind === "guest" ? (en ? "You" : "Vous") : entry.sender_kind === "staff" ? (en ? "Restaurant" : "Restaurant") : (en ? "Update" : "Nouvelle")}</p>
              <p className="mt-0.5 break-words">{entry.body}</p>
            </div>
          )) : <p className="text-sm text-text-secondary">{en ? "Messages from the restaurant will appear here." : "Les messages du restaurant apparaîtront ici."}</p>}
        </div>
        <div className="mt-2 flex min-w-0 gap-2">
          <Input className="min-w-0" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={en ? "Message the waiter…" : "Écrire au serveur…"} />
          <Button size="icon" aria-label={en ? "Send message" : "Envoyer"} disabled={pending || !message.trim()} onClick={() => quick("message", message)}><Send className="size-4" /></Button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl font-bold">{en ? "Menu" : "Menu"}</h2>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label={en ? "Menu categories" : "Catégories du menu"}>
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
              return <button key={item.id} type="button" disabled={sold || paymentRequested}
                onClick={() => add(item)}
                className="flex min-h-28 w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left disabled:opacity-45">
                <GuestDishPhoto src={item.image_url} name={item.name} />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{item.name}</p>
                  {item.description && <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{item.description}</p>}
                  <p className="mt-2 font-bold text-primary">{formatMoney(item.price)}</p>
                </div>
                <Plus className="size-5 shrink-0" />
              </button>;
            })}
          </div>
        </div>}
      </section>

      {state.rounds.length > 0 && <section className="mt-8">
        <h2 className="font-display text-xl font-bold">{en ? "Your dish requests" : "Vos demandes de plats"}</h2>
        <ul className="mt-3 space-y-3">{state.rounds.map((round) => (
          <li key={round.id} className="rounded-lg border border-border bg-surface p-4">
            {round.dining_round_items.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-2 last:border-0">
              <div><p className="text-sm font-semibold">{item.quantity}× {item.name}</p>
                {item.rejection_reason && <p className="mt-1 text-xs text-error">{en ? "Reason" : "Motif"}: {item.rejection_reason}</p>}</div>
              <Badge tone={item.status === "accepted" ? "success" : item.status === "rejected" ? "error" : "warning"}>
                {item.status === "accepted" ? (en ? "Accepted" : "Accepté") : item.status === "rejected" ? (en ? "Declined" : "Refusé") : (en ? "Waiting" : "En attente")}
              </Badge>
            </div>)}
          </li>
        ))}</ul>
      </section>}

      {error && <div role="alert" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-lg items-start gap-2 rounded-md bg-error px-4 py-3 text-sm text-white">
        <p className="min-w-0 flex-1">{error}</p><button type="button" aria-label={en ? "Dismiss" : "Fermer"} onClick={() => setError(null)}><X className="size-4" /></button>
      </div>}
      {cart.length > 0 && <aside className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1"><p className="font-semibold">{cart.reduce((sum, line) => sum + line.quantity, 0)} {en ? "items" : "articles"}</p><p className="font-bold text-primary">{formatMoney(cartTotal)}</p></div>
          <Button size="lg" onClick={submit} loading={pending}><ShoppingBag className="size-4" />{en ? "Send order" : "Envoyer"}</Button>
        </div>
      </aside>}
    </main>
  );
}
