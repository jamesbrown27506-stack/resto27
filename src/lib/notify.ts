import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { trySendMail } from "@/lib/mail";
import { sendPush } from "@/lib/push";
import { NOTIFICATION_EVENTS } from "@/lib/data/settings";
import { readTopic, type CustomerTopicKey } from "@/lib/notifications/customer-topics";
import {
  fetchNotificationChannelsFor,
  NOTIFICATION_CHANNELS_DEFAULT,
  type NotificationChannels,
} from "@/lib/data/notification-channels";
import { formatMoney } from "@/lib/format/currency";

/**
 * THE NOTIFICATION WRITER — the one place an event becomes deliveries.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERYTHING NOTIFICATION-SHAPED GOES THROUGH HERE.
 *
 *  Given an event and its recipients, this function:
 *    1. resolves the recipients (a branch's staff, a customer, the admins),
 *    2. looks up EACH recipient's saved preferences for that event,
 *    3. builds the copy (French for managers and customers, English for the
 *       admin area — the app's established split),
 *    4. delivers through every channel that recipient enabled:
 *         in-app  → one row in the notifications table (the bell badge)
 *         email   → trySendMail (SMTP, test-mode aware)
 *         push    → the browser push service via VAPID (web-push)
 *
 *  IT NEVER THROWS. A failed delivery must not undo the order, review or
 *  payment being recorded — the same rule the audit writer and trySendMail
 *  already follow. Every channel is individually fenced.
 *
 *  A MISSING PREFERENCE ROW MEANS "the default", NOT "off" (migration 0012):
 *  nobody is opted out by never having visited the settings screen, and a new
 *  event added next month does not arrive silenced for everyone.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type NotifyTone = "info" | "success" | "warning" | "error";

export type NotifyEvent =
  | "new_order" //           → manager : a customer placed an order
  | "order_status" //        → customer: the order advanced a step
  | "order_cancelled" //     → both    : someone cancelled an order
  | "reservation" //         → manager : a new reservation request
  | "reservation_decision" //→ customer: confirmed or declined
  | "reservation_status" //  → customer: seated, completed or no-show
  | "review" //              → manager : a customer wrote a review
  | "review_reply" //        → customer: the restaurant replied
  | "moderation" //          → admin   : a review was reported
  | "application" //         → admin   : a restaurant applied for approval
  | "billing" //             → manager : plan change, extension, statement
  | "billing_paid" //        → manager : an invoice was paid
  | "billing_refund" //      → manager : a refund was issued
  | "approval" //            → owner   : restaurant approved / suspended / reinstated
  | "account" //             → user    : account suspended / reinstated
  | "low_stock" //           → manager : a tracked dish crossed its threshold
  | "loyalty" //             → customer: points earned
  | "broadcast" //           → anyone  : platform broadcast (copy passes through)
  | "new_subscription" //    → admin   : a tenant chose a plan / started a trial
  | "support" //             → admin   : a support message arrived
  | "chat" //                → staff   : a customer sent a message (restaurant or platform thread)
  | "chat_reply" //          → customer: the other side replied
  | "push_enabled"; //       → self    : "push is on", sent the moment it is

/*
 * Events whose push banner must STAY on screen until dismissed (desktop;
 * sw.js applies this only when no window is visible). A new order is the
 * product; one that slides away behind other windows after five seconds is
 * an order the kitchen never saw. A customer chat message is the same shape
 * of emergency from the other side. Everything else stays auto-dismissing.
 */
const REQUIRE_INTERACTION_EVENTS: ReadonlySet<NotifyEvent> = new Set<NotifyEvent>(["new_order", "chat"]);

export interface NotifyParams {
  reference?: string;
  restaurantName?: string;
  customerName?: string;
  amount?: number;
  /** Status word — an order step for order_status, a restaurant/account
      verdict for approval and account. */
  status?:
    | "pending"
    | "active"
    /** A booking the restaurant accepted that still owes its deposit (0039). */
    | "awaiting_payment"
    /** A delivery order whose quoted fee the customer has not accepted (0040). */
    | "awaiting_customer"
    | "confirmed"
    | "seated"
    | "completed"
    | "no_show"
    | "preparing"
    | "shipped"
    | "delivered"
    | "cancelled"
    | "suspended";
  /** Who cancelled — decides whose side of the copy the manager reads. */
  cancelledBy?: "customer" | "restaurant";
  deliveryFee?: number;
  reason?: string;
  partySize?: number;
  rating?: number;
  reply?: string;
  itemName?: string;
  count?: number;
  points?: number;
  invoiceNumber?: string;
  planName?: string;
  /** Broadcast passthrough — subject/body are the admin's own words. */
  subject?: string;
  bodyText?: string;
  detail?: string;
  /** First ~80 characters of a chat message — the notification preview. */
  preview?: string;
  /** The platform's own name, for copy that would otherwise hardcode it. */
  platformName?: string;
}

export interface NotifyInput {
  event: NotifyEvent;
  tone?: NotifyTone;
  /** Deep link — the notifications table's href column, tapped to open. */
  href?: string | null;
  params?: NotifyParams;
  /** Notify every ACTIVE staff member of this branch. */
  restaurantId?: string;
  /** Notify one registered customer. */
  customerId?: string | null;
  /** Notify every active admin. */
  admins?: boolean;
  /** Notify every active profile holding one of these roles — broadcasts. */
  roles?: ("manager" | "customer" | "admin")[];
  /** Notify exactly one active profile, whatever its role — the diagnostics tester. */
  profileId?: string;
  /** Channel overrides. `false` forces a channel off regardless of prefs —
      e.g. approval, where the caller already sent its own richer email. */
  email?: boolean;
  inApp?: boolean;
  push?: boolean;
  /**
   * Hard per-channel overrides for callers that must win over prefs — the
   * broadcast composer uses this: in-app always, email exactly when the
   * admin asked for it, push left to the user's own pref.
   */
  channels?: { inApp?: boolean; email?: boolean; push?: boolean };
}

interface Recipient {
  profileId: string;
  name: string;
  email: string;
  kind: "manager" | "customer" | "admin";
}

type Locale = "fr" | "en";

/* ── Copy ──────────────────────────────────────────────────────────────── */

const FR_ORDER_STATUS: Record<string, string> = {
  pending: "reçue",
  confirmed: "confirmée",
  preparing: "en préparation",
  shipped: "en route",
  delivered: "livrée",
};

const EN_ORDER_STATUS: Record<string, string> = {
  pending: "received",
  confirmed: "confirmed",
  preparing: "being prepared",
  shipped: "out for delivery",
  delivered: "delivered",
};

function copy(event: NotifyEvent, p: NotifyParams, locale: Locale): { title: string; body: string } {
  const fr = locale === "fr";
  const money = (n?: number) => (n === undefined ? "" : formatMoney(n));

  switch (event) {
    case "new_order":
      return fr
        ? {
            title: `Nouvelle commande ${p.reference ?? ""}`,
            body: `${p.customerName ?? "Client"} · ${money(p.amount)}`,
          }
        : {
            title: `New order ${p.reference ?? ""}`,
            body: `${p.customerName ?? "Customer"} · ${money(p.amount)}`,
          };

    case "order_status": {
      /*
        A QUOTED FEE IS A QUESTION, NOT A PROGRESS UPDATE.

        Every other status here is news the customer reads and does nothing
        about. `awaiting_customer` is the one that stops until they answer, and
        the order does not move — and the kitchen does not start — until they
        do. Wording it like the others ("your order is awaiting customer")
        would bury the only notification in the flow that needs an action.
      */
      if (p.status === "awaiting_customer") {
        const quoted = p.deliveryFee !== undefined ? money(p.deliveryFee) : "";
        return fr
          ? {
              title: `Commande ${p.reference ?? ""} — frais de livraison à valider`,
              body: `${p.restaurantName ?? "Le restaurant"} chiffre la livraison à ${quoted}. Acceptez ou refusez : la préparation ne démarre qu'après votre réponse.`,
            }
          : {
              title: `Order ${p.reference ?? ""} — delivery fee to approve`,
              body: `${p.restaurantName ?? "The restaurant"} quotes ${quoted} for delivery. Accept or decline — nothing is cooked until you answer.`,
            };
      }

      const word = (fr ? FR_ORDER_STATUS : EN_ORDER_STATUS)[p.status ?? ""] ?? p.status ?? "";
      const fee = p.deliveryFee !== undefined ? ` · livraison ${money(p.deliveryFee)}` : "";
      return fr
        ? {
            title: `Commande ${p.reference ?? ""} ${word}`,
            body: `Votre commande chez ${p.restaurantName ?? "le restaurant"} est ${word}.${fee}`,
          }
        : {
            title: `Order ${p.reference ?? ""} ${word}`,
            body: `Your order at ${p.restaurantName ?? "the restaurant"} is ${word}.${fee}`,
          };
    }

    case "order_cancelled": {
      const byCustomer = p.cancelledBy === "customer";
      return fr
        ? byCustomer
          ? { title: `Commande ${p.reference ?? ""} annulée`, body: "Annulée par le client." }
          : {
              title: `Commande ${p.reference ?? ""} annulée`,
              body: `Votre commande chez ${p.restaurantName ?? "le restaurant"} a été annulée.${
                p.reason ? ` Raison : ${p.reason}` : ""
              }`,
            }
        : byCustomer
          ? { title: `Order ${p.reference ?? ""} cancelled`, body: "Cancelled by the customer." }
          : {
              title: `Order ${p.reference ?? ""} cancelled`,
              body: `Your order at ${p.restaurantName ?? "the restaurant"} was cancelled.${
                p.reason ? ` Reason: ${p.reason}` : ""
              }`,
            };
    }

    case "reservation":
      if (p.status === "confirmed") {
        return fr
          ? {
              title: `Acompte ${p.reference ?? ""} réglé`,
              body: "L'acompte a été réglé. La réservation est maintenant confirmée.",
            }
          : {
              title: `Deposit ${p.reference ?? ""} paid`,
              body: "The deposit was paid. The reservation is now confirmed.",
            };
      }
      if (p.status === "cancelled" && p.cancelledBy === "customer") {
        return fr
          ? {
              title: `Réservation ${p.reference ?? ""} annulée`,
              body: `${p.customerName ?? "Le client"} a annulé sa réservation. La table est libérée.`,
            }
          : {
              title: `Reservation ${p.reference ?? ""} cancelled`,
              body: `${p.customerName ?? "The guest"} cancelled the reservation. The table is released.`,
            };
      }
      return fr
        ? {
            title: `Nouvelle réservation ${p.reference ?? ""}`,
            body: `${p.customerName ?? "Client"} · ${p.partySize ?? 1} pers.`,
          }
        : {
            title: `New reservation ${p.reference ?? ""}`,
            body: `${p.customerName ?? "Guest"} · ${p.partySize ?? 1} people`,
          };

    case "reservation_decision": {
      /*
        THREE OUTCOMES, NOT TWO. The third is the one that needs an action.

        A restaurant that accepts a booking with a deposit outstanding has not
        confirmed it — the table is being held, and it is released if nobody
        pays. Sending "your table is booked" there would be a promise the
        booking has not earned, and the customer would have no idea anything
        was expected of them until the seat was gone.
      */
      const awaiting = p.status === "awaiting_payment";
      const confirmed = p.status === "confirmed";
      const amount = p.amount !== undefined ? formatMoney(p.amount) : "";

      if (awaiting) {
        return fr
          ? {
              title: `Réservation ${p.reference ?? ""} acceptée — acompte à régler`,
              body: `${p.restaurantName ?? "Le restaurant"} garde votre table. Réglez l'acompte de ${amount} pour la confirmer.`,
            }
          : {
              title: `Reservation ${p.reference ?? ""} accepted — deposit due`,
              body: `${p.restaurantName ?? "The restaurant"} is holding your table. Pay the ${amount} deposit to confirm it.`,
            };
      }

      return fr
        ? confirmed
          ? {
              title: `Réservation ${p.reference ?? ""} confirmée`,
              body: `Votre table chez ${p.restaurantName ?? "le restaurant"} est réservée.`,
            }
          : {
              title: `Réservation ${p.reference ?? ""} refusée`,
              body: `Raison : ${p.reason ?? "Non précisée"}`,
            }
        : confirmed
          ? {
              title: `Reservation ${p.reference ?? ""} confirmed`,
              body: `Your table at ${p.restaurantName ?? "the restaurant"} is booked.`,
            }
          : {
              title: `Reservation ${p.reference ?? ""} declined`,
              body: `Reason: ${p.reason ?? "Not specified"}`,
            };
    }

    case "reservation_status": {
      if (p.status === "seated") {
        return fr
          ? {
              title: `Réservation ${p.reference ?? ""} — table installée`,
              body: `${p.restaurantName ?? "Le restaurant"} a marqué votre arrivée. Bon appétit !`,
            }
          : {
              title: `Reservation ${p.reference ?? ""} — seated`,
              body: `${p.restaurantName ?? "The restaurant"} marked your arrival. Enjoy your meal!`,
            };
      }
      if (p.status === "completed") {
        return fr
          ? {
              title: `Réservation ${p.reference ?? ""} terminée`,
              body: `Votre visite chez ${p.restaurantName ?? "le restaurant"} est maintenant dans votre historique.`,
            }
          : {
              title: `Reservation ${p.reference ?? ""} completed`,
              body: `Your visit to ${p.restaurantName ?? "the restaurant"} is now in your history.`,
            };
      }
      return fr
        ? {
            title: `Réservation ${p.reference ?? ""} — absence enregistrée`,
            body: `${p.restaurantName ?? "Le restaurant"} a marqué cette réservation comme non présentée.`,
          }
        : {
            title: `Reservation ${p.reference ?? ""} — no show`,
            body: `${p.restaurantName ?? "The restaurant"} marked this reservation as a no-show.`,
          };
    }

    case "review":
      return fr
        ? {
            title: `Nouvel avis ${p.rating ?? ""}/5`,
            body: `${p.customerName ?? "Client"} a noté votre restaurant ${p.rating ?? ""}/5.`,
          }
        : {
            title: `New review ${p.rating ?? ""}/5`,
            body: `${p.customerName ?? "Customer"} rated your restaurant ${p.rating ?? ""}/5.`,
          };

    case "review_reply":
      return fr
        ? {
            title: "Réponse à votre avis",
            body: `${p.restaurantName ?? "Le restaurant"} a répondu : ${p.reply ?? ""}`,
          }
        : {
            title: "Reply to your review",
            body: `${p.restaurantName ?? "The restaurant"} replied: ${p.reply ?? ""}`,
          };

    case "moderation":
      return {
        title: "Review reported",
        body: p.rating
          ? `${p.restaurantName ?? "A restaurant"} reported a ${p.rating}-star review.`
          : `${p.restaurantName ?? "A restaurant"} reported a review.`,
      };

    case "application":
      // The admin bell is the approval queue's doorbell: a pending
      // application waits for the verdict, and silence is how it is missed.
      return {
        title: "New application",
        body: `${p.restaurantName ?? "A restaurant"} applied to join the platform.`,
      };

    case "billing":
      return fr
        ? {
            title: "Mise à jour de facturation",
            body: p.detail ?? "Votre abonnement a été mis à jour.",
          }
        : {
            title: "Billing update",
            body: p.detail ?? "Your subscription was updated.",
          };

    case "billing_paid":
      return fr
        ? {
            title: "Paiement reçu",
            body: `Facture ${p.invoiceNumber ?? ""} — ${money(p.amount)} réglée.`,
          }
        : {
            title: "Payment received",
            body: `Invoice ${p.invoiceNumber ?? ""} — ${money(p.amount)} settled.`,
          };

    case "billing_refund":
      return fr
        ? {
            title: `Remboursement ${p.reference ?? ""}`,
            body: `${money(p.amount)} — ${p.reason ?? "Remboursement"}`,
          }
        : {
            title: `Refund ${p.reference ?? ""}`,
            body: `${money(p.amount)} — ${p.reason ?? "Refund"}`,
          };

    case "approval": {
      const status = p.status ?? "active";
      if (status === "suspended") {
        return fr
          ? {
              title: "Compte suspendu",
              body: `${p.restaurantName ?? "Votre restaurant"} a été suspendu par la plateforme.`,
            }
          : { title: "Account suspended", body: `${p.restaurantName ?? "Your restaurant"} was suspended.` };
      }
      if (status === "pending") {
        return fr
          ? {
              title: "Restaurant en attente",
              body: `${p.restaurantName ?? "Votre restaurant"} est en attente de validation.`,
            }
          : { title: "Restaurant pending", body: `${p.restaurantName ?? "Your restaurant"} awaits approval.` };
      }
      return fr
        ? {
            title: "Votre restaurant est en ligne !",
            body: `${p.restaurantName ?? "Votre restaurant"} est approuvé et visible par les clients.`,
          }
        : {
            title: "Your restaurant is live!",
            body: `${p.restaurantName ?? "Your restaurant"} is approved and visible to customers.`,
          };
    }

    case "account": {
      const suspended = p.status === "suspended";
      return fr
        ? suspended
          ? { title: "Compte suspendu", body: "Votre compte a été suspendu par la plateforme." }
          : { title: "Compte réactivé", body: "Votre compte est de nouveau actif." }
        : suspended
          ? { title: "Account suspended", body: "Your account was suspended by the platform." }
          : { title: "Account reinstated", body: "Your account is active again." };
    }

    case "low_stock":
      return fr
        ? {
            title: "Stock faible",
            body: `${p.itemName ?? "Un plat"} : plus que ${p.count ?? 0} restant(s).`,
          }
        : {
            title: "Low stock",
            body: `${p.itemName ?? "An item"}: only ${p.count ?? 0} left.`,
          };

    case "loyalty":
      return fr
        ? {
            title: "Points fidélité crédités",
            body: `+${p.points ?? 0} points sur votre commande ${p.reference ?? ""}.`,
          }
        : {
            title: "Loyalty points credited",
            body: `+${p.points ?? 0} points on your order ${p.reference ?? ""}.`,
          };

    case "broadcast":
      return { title: p.subject ?? "Message", body: p.bodyText ?? "" };

    case "new_subscription":
      return {
        title: "New subscription",
        body: `${p.restaurantName ?? "A restaurant"} chose ${p.planName ?? "a plan"}.`,
      };

    case "support":
      return { title: `New support message`, body: `${p.customerName ?? ""} · ${p.subject ?? ""}` };

    case "chat":
      // The staff side: a customer wrote, either about their order or to the
      // platform. Admins get the English variant via their locale.
      return fr
        ? {
            title: `Nouveau message de ${p.customerName ?? "un client"}`,
            body: p.preview ?? p.subject ?? "",
          }
        : {
            title: `New message from ${p.customerName ?? "a customer"}`,
            body: p.preview ?? p.subject ?? "",
          };

    case "chat_reply":
      // The customer side: someone answered.
      return fr
        ? {
            title: `Réponse de ${p.restaurantName ?? p.platformName ?? "l'équipe"}`,
            body: p.preview ?? "",
          }
        : {
            title: `Reply from ${p.restaurantName ?? p.platformName ?? "the team"}`,
            body: p.preview ?? "",
          };

    case "push_enabled":
      // The proof, not a promise. Sent to whoever just switched push on, over
      // the very channel they enabled — if this one does not arrive, push does
      // not work on that device, and they find out now rather than the night a
      // real order goes missing.
      return fr
        ? {
            title: "Notifications push activées",
            body: "Vous recevrez désormais les alertes sur cet appareil, même quand l'onglet est fermé.",
          }
        : {
            title: "Push notifications enabled",
            body: "You will now get alerts on this device, even when the tab is closed.",
          };
  }
}

/* ── Recipient resolution ──────────────────────────────────────────────── */

async function resolveRecipients(input: NotifyInput): Promise<Recipient[]> {
  const supabase = createAdminClient();
  const byId = new Map<string, Recipient>();
  const add = (r: Recipient) => byId.set(r.profileId, r);

  if (input.restaurantId) {
    const { data } = await supabase
      .from("restaurant_staff")
      .select(
        `profile_id,
         profiles!restaurant_staff_profile_id_fkey ( id, name, email, status, deleted_at )`,
      )
      .eq("restaurant_id", input.restaurantId)
      .eq("status", "active");

    for (const row of (data ?? []) as unknown as {
      profile_id: string | null;
      profiles: { id: string; name: string; email: string; status: string; deleted_at: string | null } | null;
    }[]) {
      const p = row.profiles;
      if (!row.profile_id || !p) continue;
      if (p.status !== "active" || p.deleted_at) continue;
      add({ profileId: p.id, name: p.name, email: p.email, kind: "manager" });
    }
  }

  if (input.customerId) {
    const { data } = await supabase
      .from("profiles")
      .select("id, name, email, status, deleted_at")
      .eq("id", input.customerId)
      .maybeSingle();
    // A suspended account still needs to read "you were suspended" — only
    // the account event may reach one.
    const usable = data && !data.deleted_at && (data.status === "active" || (data.status === "suspended" && input.event === "account"));
    if (usable) {
      add({ profileId: data.id, name: data.name, email: data.email, kind: "customer" });
    }
  }

  if (input.admins) {
    const { data } = await supabase
      .from("profiles")
      .select("id, name, email")
      .eq("role", "admin")
      .eq("status", "active")
      .is("deleted_at", null);
    for (const row of (data ?? []) as { id: string; name: string; email: string }[]) {
      add({ profileId: row.id, name: row.name, email: row.email, kind: "admin" });
    }
  }

  if (input.profileId) {
    const { data } = await supabase
      .from("profiles")
      .select("id, name, email, role, status, deleted_at")
      .eq("id", input.profileId)
      .maybeSingle();
    const usable = data && !data.deleted_at && data.status === "active";
    if (usable) {
      const kind = data.role === "admin" ? "admin" : data.role === "manager" ? "manager" : "customer";
      add({ profileId: data.id, name: data.name, email: data.email, kind });
    }
  }

  if (input.roles?.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id, name, email, role")
      .in("role", input.roles)
      .eq("status", "active")
      .is("deleted_at", null);
    for (const row of (data ?? []) as { id: string; name: string; email: string; role: string }[]) {
      const kind = row.role === "admin" ? "admin" : row.role === "manager" ? "manager" : "customer";
      add({ profileId: row.id, name: row.name, email: row.email, kind });
    }
  }

  return [...byId.values()];
}

/* ── Preference resolution ─────────────────────────────────────────────── */

interface Channels {
  inApp: boolean;
  email: boolean;
  push: boolean;
}

/**
 * Which customer topic each event belongs to. The answers live in
 * notification_json (migration 0014), now per channel — see
 * lib/notifications/customer-topics.
 *
 * `review_reply` and `chat_reply` used to fall through this map to "always
 * on", which meant a customer could not turn off a mail for every reply to
 * every review or message they had ever left. They have topics now.
 *
 * Events with no entry are still always on, and correctly so: `account` and
 * `approval` are things happening TO the account, not messages about it.
 */
const CUSTOMER_PREF_KEY: Partial<Record<NotifyEvent, CustomerTopicKey>> = {
  order_status: "order_status",
  order_cancelled: "order_status",
  reservation_decision: "reservations",
  reservation_status: "reservations",
  chat_reply: "messages",
  review_reply: "reviews",
  loyalty: "loyalty",
  broadcast: "promotions",
};

function managerDefaults(event: NotifyEvent): Channels {
  const known = NOTIFICATION_EVENTS.find((e) => e.key === event);
  if (known) {
    return { inApp: known.inApp, email: known.email, push: true };
  }
  // Events outside the catalogue (approval, account, low_stock, broadcasts…)
  // default to everything on.
  return { inApp: true, email: true, push: true };
}



/**
 * WHICH EVENT reaches this person — the per-role, per-event answer only.
 * The master channel switches are applied on top of this by `channelsFor`.
 */
function eventChannelsFor(
  recipient: Recipient,
  event: NotifyEvent,
  restaurantId: string | undefined,
  managerPrefs: Map<string, { in_app: boolean; email: boolean; push: boolean }>,
  customerPrefs: Map<string, { notification_json: unknown; push_enabled: boolean }>,
): Channels {
  if (recipient.kind === "admin") return { inApp: true, email: true, push: true };

  if (recipient.kind === "manager" && restaurantId) {
    const stored = managerPrefs.get(recipient.profileId);
    const defaults = managerDefaults(event);
    return {
      inApp: stored?.in_app ?? defaults.inApp,
      email: stored?.email ?? defaults.email,
      push: stored?.push ?? defaults.push,
    };
  }

  if (recipient.kind === "customer") {
    const key = CUSTOMER_PREF_KEY[event];
    // No topic — `account`, `approval`, `push_enabled` — is not a preference.
    if (!key) return { inApp: true, email: true, push: true };

    const stored = customerPrefs.get(recipient.profileId);
    const json =
      typeof stored?.notification_json === "object" && stored.notification_json !== null
        ? (stored.notification_json as Record<string, unknown>)
        : {};

    // `push_enabled` is the legacy column, and it is only consulted for a row
    // still in the old boolean shape — readTopic decides which shape it has.
    return readTopic(key, json[key], stored?.push_enabled ?? true);
  }

  return { inApp: true, email: true, push: true };
}

/**
 * The resolved answer: the event's own preference AND the person's master
 * channel switches (migration 0027).
 *
 * Both must say yes. A manager who wants "new order" by email still gets no
 * email if they turned email off entirely, and an admin — who has no
 * per-event grid at all — is now governed by the master switches instead of
 * the hardcoded all-on this function used to return.
 */
function channelsFor(
  recipient: Recipient,
  event: NotifyEvent,
  restaurantId: string | undefined,
  managerPrefs: Map<string, { in_app: boolean; email: boolean; push: boolean }>,
  customerPrefs: Map<string, { notification_json: unknown; push_enabled: boolean }>,
  masters: Map<string, NotificationChannels>,
): Channels {
  const perEvent = eventChannelsFor(recipient, event, restaurantId, managerPrefs, customerPrefs);
  const master = masters.get(recipient.profileId) ?? NOTIFICATION_CHANNELS_DEFAULT;

  return {
    inApp: perEvent.inApp && master.inApp,
    email: perEvent.email && master.email,
    push: perEvent.push && master.push,
  };
}

/* ── The writer ────────────────────────────────────────────────────────── */

/**
 * Deliver one event to everyone who should see it. Never throws.
 *
 * Callers fire this AFTER the operation it describes has been recorded — the
 * notification is news about an order, never part of placing it.
 *
 * Returns how many in-app rows were written, so callers like the broadcast
 * composer can record a real delivered count.
 */
export async function notify(input: NotifyInput): Promise<{ delivered: number }> {
  try {
    const recipients = await resolveRecipients(input);
    if (recipients.length === 0) return { delivered: 0 };

    const supabase = createAdminClient();

    // ── Bulk-load preferences, one query per shape ──────────────────────
    const managerIds = recipients.filter((r) => r.kind === "manager").map((r) => r.profileId);
    const customerIds = recipients.filter((r) => r.kind === "customer").map((r) => r.profileId);

    const managerPrefs = new Map<
      string,
      { in_app: boolean; email: boolean; push: boolean }
    >();
    if (input.restaurantId && managerIds.length > 0) {
      const { data } = await supabase
        .from("notification_preferences")
        .select("profile_id, in_app, email, push")
        .eq("restaurant_id", input.restaurantId)
        .in("profile_id", managerIds)
        .eq("event_key", input.event === "order_cancelled" ? "order_cancelled" : input.event);
      for (const row of (data ?? []) as {
        profile_id: string;
        in_app: boolean;
        email: boolean;
        push: boolean;
      }[]) {
        managerPrefs.set(row.profile_id, { in_app: row.in_app, email: row.email, push: row.push });
      }
    }

    const customerPrefs = new Map<
      string,
      { notification_json: unknown; push_enabled: boolean }
    >();
    if (customerIds.length > 0) {
      const { data } = await supabase
        .from("customer_preferences")
        .select("profile_id, notification_json, push_enabled")
        .in("profile_id", customerIds);
      for (const row of (data ?? []) as {
        profile_id: string;
        notification_json: unknown;
        push_enabled: boolean;
      }[]) {
        customerPrefs.set(row.profile_id, {
          notification_json: row.notification_json ?? {},
          push_enabled: row.push_enabled,
        });
      }
    }

    // The master switches (0027) — one query for the whole recipient list,
    // every role, defaults for anyone who has never opened the screen.
    const masterChannels = await fetchNotificationChannelsFor(recipients.map((r) => r.profileId));

    /*
      One query for every recipient's language.

      Inside the same batch as the preference reads above, not per recipient:
      a broadcast to every customer on the platform must not become one round
      trip per person. A profile whose row is missing or whose column is not
      there yet (migration 0036 unrun) simply falls back to the role default,
      which is the previous behaviour.
    */
    const localeByProfile = new Map<string, Locale>();
    {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, locale")
        .in("id", recipients.map((r) => r.profileId));

      if (error) {
        console.error("[notify] locale lookup", error.message);
      } else {
        for (const row of (data ?? []) as { id: string; locale: string | null }[]) {
          if (row.locale === "fr" || row.locale === "en") {
            localeByProfile.set(row.id, row.locale);
          }
        }
      }
    }

    const tone = input.tone ?? "info";
    const params = input.params ?? {};
    const href = input.href ?? null;

    // ── Deliver per recipient, each channel fenced ──────────────────────
    const inAppRows: { profile_id: string; title: string; body: string; tone: NotifyTone; href: string | null }[] = [];
    const emails: { to: string; subject: string; body: string }[] = [];
    const pushes: {
      profileId: string;
      title: string;
      body: string;
      href: string | null;
      tone: NotifyTone;
      locale: Locale;
    }[] = [];

    for (const recipient of recipients) {
      /*
        THE RECIPIENT'S OWN LANGUAGE, NOT THEIR ROLE'S.

        This used to read `recipient.kind === "admin" ? "en" : "fr"`, so the
        language was decided by which part of the app you worked in. Every
        manager and every customer got French — bell, email and push — no
        matter which way they had set the FR/EN toggle, because a toggle
        writes a cookie and there is no cookie anywhere near this code.

        `profiles.locale` (migration 0036) is written by the toggle for
        exactly this. Admins keep English as their default: the admin area is
        English by design, and an admin who has explicitly chosen French
        still gets it, because their stored preference wins over the default
        below.
      */
      const stored = localeByProfile.get(recipient.profileId);
      const locale: Locale =
        stored ?? (recipient.kind === "admin" ? "en" : "fr");
      const text = copy(input.event, params, locale);
      const prefs = channelsFor(
        recipient,
        input.event,
        input.restaurantId,
        managerPrefs,
        customerPrefs,
        masterChannels,
      );

      const inApp = input.inApp !== false && (input.channels?.inApp ?? prefs.inApp);
      const email = input.email !== false && (input.channels?.email ?? prefs.email);
      const push = input.push !== false && (input.channels?.push ?? prefs.push);

      if (inApp) {
        inAppRows.push({
          profile_id: recipient.profileId,
          title: text.title,
          body: text.body,
          tone,
          href,
        });
      }
      if (email && recipient.email) {
        emails.push({
          to: recipient.email,
          subject: text.title,
          body: [text.title, "", text.body, href ? `${href}` : "", "", `— RestoLink`].join("\n"),
        });
      }
      if (push) {
        pushes.push({
          profileId: recipient.profileId,
          title: text.title,
          body: text.body,
          href,
          // Tone and language travel WITH the push now: when the banner is
          // announced by the service worker's postMessage (tab open, app
          // hidden), the toast used to always read as "info" because the
          // payload carried nothing else.
          tone,
          locale,
        });
      }
    }

    if (inAppRows.length > 0) {
      const { error } = await supabase.from("notifications").insert(inAppRows);
      if (error) console.error("[notify] in-app insert failed", error.message);
    }

    await Promise.allSettled(emails.map((m) => trySendMail({ to: m.to, subject: m.subject, body: m.body })));
    await Promise.allSettled(
      pushes.map((p) =>
        sendPush(p.profileId, {
          title: p.title,
          body: p.body,
          href: p.href,
          /*
            PER-EVENT COLLAPSE KEY. sw.js was already reading `data.tag`,
            but the server never sent one — so every push shared the
            default tag and a new order REPLACED an unread chat reply on
            the lock screen. Distinct events now stack; repeats of the
            same event still replace each other (renotify) instead of
            building a dismiss-one-by-one pile.
          */
          tag: `restolink:${input.event}`,
          tone: p.tone,
          lang: p.locale,
          requireInteraction: REQUIRE_INTERACTION_EVENTS.has(input.event),
        }),
      ),
    );

    return { delivered: inAppRows.length };
  } catch (error) {
    // Never throw — see the file header.
    console.error("[notify] failed", input.event, error);
    return { delivered: 0 };
  }
}
