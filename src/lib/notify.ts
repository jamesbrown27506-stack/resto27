import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { trySendMail } from "@/lib/mail";
import { sendPush, sendPushWithReport, type PushPayload } from "@/lib/push";
import { siteUrl } from "@/lib/site-url";
import { getBranding } from "@/lib/branding";
import { NOTIFICATION_EVENTS, type NotificationEventKey } from "@/lib/data/settings";
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
  | "order_delayed" //       → both    : a shipped delivery is overdue (cron)
  | "reservation_reminder" //→ customer: the booked slot is tomorrow / soon (cron)
  | "review_prompt" //       → customer: yesterday's delivered order can be rated (cron)
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
  /**
   * The order's fulfilment mode. The words fork on it: a pickup order is
   * "ready to collect", never "out for delivery" — the same fork the
   * in-app UI already made (order-status.ts, commit 3fc967f).
   */
  orderType?: "delivery" | "pickup" | "dine_in";
  /** Which side of the counter reads this copy, for two-sided cron events. */
  audience?: "customer" | "staff";
  /** True on a watchdog re-send — the copy says "still waiting", not "new". */
  reminder?: boolean;
  /** reservation_reminder: how far out the slot is. */
  stage?: "day" | "soon";
  /** A pre-formatted, recipient-facing time ("sam. 30 août, 20:00"). */
  whenLabel?: string;
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
      /*
        Three voices for one event, told apart by params:
          · reminder    — the watchdog re-ring for an order nobody has
            accepted. Same collapse tag as the original, so the banner is
            REPLACED and re-buzzes (renotify) instead of stacking.
          · whenLabel   — a scheduled order whose prep window has arrived.
          · neither     — the original "a customer just ordered".
      */
      if (p.reminder) {
        return fr
          ? {
              title: `Commande ${p.reference ?? ""} toujours en attente`,
              body: `${p.customerName ?? "Client"} · ${money(p.amount)} — personne n'a encore confirmé.`,
            }
          : {
              title: `Order ${p.reference ?? ""} still waiting`,
              body: `${p.customerName ?? "Customer"} · ${money(p.amount)} — nobody has confirmed it yet.`,
            };
      }
      if (p.whenLabel) {
        return fr
          ? {
              title: `Commande programmée ${p.reference ?? ""} — pour ${p.whenLabel}`,
              body: `${p.customerName ?? "Client"} · ${money(p.amount)}. C'est le moment de la préparer.`,
            }
          : {
              title: `Scheduled order ${p.reference ?? ""} — for ${p.whenLabel}`,
              body: `${p.customerName ?? "Customer"} · ${money(p.amount)}. Time to start preparing it.`,
            };
      }
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

      /*
        THE WORDS FOLLOW THE FULFILMENT MODE. "Out for delivery" on a pickup
        order contradicts the very screen the push deep-links to — the UI
        forked this copy per type long ago (commit 3fc967f); the push now
        forks with it. A pickup order that is ready is the one push in the
        flow that asks the customer to stand up, so it gets its own title.
      */
      if (p.orderType === "pickup" && p.status === "shipped") {
        return fr
          ? {
              title: `Commande ${p.reference ?? ""} prête !`,
              body: `Votre commande chez ${p.restaurantName ?? "le restaurant"} est prête à récupérer.`,
            }
          : {
              title: `Order ${p.reference ?? ""} is ready!`,
              body: `Your order at ${p.restaurantName ?? "the restaurant"} is ready for pickup.`,
            };
      }
      const typeWords: Record<string, Record<string, { fr: string; en: string }>> = {
        pickup: { delivered: { fr: "récupérée", en: "collected" } },
        dine_in: {
          shipped: { fr: "servie", en: "served" },
          delivered: { fr: "terminée", en: "complete" },
        },
      };
      const forked = p.orderType ? typeWords[p.orderType]?.[p.status ?? ""] : undefined;
      const word =
        (forked ? (fr ? forked.fr : forked.en) : undefined) ??
        (fr ? FR_ORDER_STATUS : EN_ORDER_STATUS)[p.status ?? ""] ??
        p.status ??
        "";
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

    case "order_delayed":
      // Two audiences, one event: the customer needs reassurance and honesty;
      // the kitchen needs the age of the problem and a nudge to act. The
      // awaiting_customer variant is the fee quote nobody answered — the
      // phone number on the ticket is the way out.
      if (p.audience === "staff" && p.status === "awaiting_customer") {
        return fr
          ? {
              title: `Devis sans réponse — commande ${p.reference ?? ""}`,
              body: "Le client n'a pas répondu au devis de livraison depuis plus d'une heure. Appelez-le, ou annulez la commande.",
            }
          : {
              title: `Quote unanswered — order ${p.reference ?? ""}`,
              body: "The customer has not answered the delivery quote for over an hour. Call them, or cancel the order.",
            };
      }
      return p.audience === "staff"
        ? fr
          ? {
              title: `Commande ${p.reference ?? ""} en retard de livraison`,
              body: "Expédiée depuis plus de 30 minutes sans confirmation de livraison. Vérifiez avec votre livreur.",
            }
          : {
              title: `Order ${p.reference ?? ""} delivery overdue`,
              body: "Marked out for delivery over 30 minutes ago with no confirmation. Check with your rider.",
            }
        : fr
          ? {
              title: `Commande ${p.reference ?? ""} — livraison retardée`,
              body: `Votre livraison chez ${p.restaurantName ?? "le restaurant"} prend plus de temps que prévu. Le restaurant a été alerté.`,
            }
          : {
              title: `Order ${p.reference ?? ""} — delivery delayed`,
              body: `Your delivery from ${p.restaurantName ?? "the restaurant"} is taking longer than expected. The restaurant has been alerted.`,
            };

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
      if (p.status === "cancelled") {
        // Released by the platform, not by either party: the deposit never
        // came and the slot has passed. Honest wording — "the client
        // cancelled" would blame someone who merely went quiet.
        return fr
          ? {
              title: `Réservation ${p.reference ?? ""} libérée`,
              body: `Acompte non réglé avant l'heure de la réservation — la table est de nouveau disponible.`,
            }
          : {
              title: `Reservation ${p.reference ?? ""} released`,
              body: `The deposit was never paid and the slot has passed — the table is available again.`,
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
      /*
        The RECEIPT, before any decision exists. Orders already confirm both
        ways at placement; bookings told only the restaurant, and the customer
        held nothing that said their request was real. Same collapse tag as
        the decision, so the answer replaces the receipt on the lock screen.
      */
      if (p.status === "pending") {
        return fr
          ? {
              title: `Demande ${p.reference ?? ""} envoyée`,
              body: `${p.restaurantName ?? "Le restaurant"} confirme sous peu — ${p.partySize ?? 1} pers.${p.whenLabel ? `, ${p.whenLabel}` : ""}`,
            }
          : {
              title: `Request ${p.reference ?? ""} sent`,
              body: `${p.restaurantName ?? "The restaurant"} will confirm shortly — ${p.partySize ?? 1} people${p.whenLabel ? `, ${p.whenLabel}` : ""}`,
            };
      }

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

    case "reservation_reminder":
      // The defense against forgetting — most no-shows are nothing worse.
      return p.stage === "soon"
        ? fr
          ? {
              title: `C'est bientôt — votre table chez ${p.restaurantName ?? "le restaurant"}`,
              body: `Réservation ${p.reference ?? ""} à ${p.whenLabel ?? ""} pour ${p.partySize ?? 1} pers. À tout de suite !`,
            }
          : {
              title: `Coming up — your table at ${p.restaurantName ?? "the restaurant"}`,
              body: `Reservation ${p.reference ?? ""} at ${p.whenLabel ?? ""} for ${p.partySize ?? 1}. See you soon!`,
            }
        : fr
          ? {
              title: `Rappel — votre table chez ${p.restaurantName ?? "le restaurant"} demain`,
              body: `Réservation ${p.reference ?? ""} · ${p.whenLabel ?? ""} · ${p.partySize ?? 1} pers. Un empêchement ? Annulez depuis l'application pour libérer la table.`,
            }
          : {
              title: `Reminder — your table at ${p.restaurantName ?? "the restaurant"} tomorrow`,
              body: `Reservation ${p.reference ?? ""} · ${p.whenLabel ?? ""} · ${p.partySize ?? 1} people. Can't make it? Cancel in the app to free the table.`,
            };

    case "review_prompt":
      return fr
        ? {
            title: `Comment était ${p.restaurantName ?? "votre commande"} ?`,
            body: `Notez votre commande ${p.reference ?? ""} — deux tapes suffisent, et les autres gourmands vous remercient.`,
          }
        : {
            title: `How was ${p.restaurantName ?? "your order"}?`,
            body: `Rate your order ${p.reference ?? ""} — it takes two taps and helps everyone else choose.`,
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

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY QUERY HERE DISCARDED ITS ERROR, AND THE RESULT WAS SILENCE.
 *
 *  `const { data } = await …` with no `error` means a failed staff lookup is
 *  indistinguishable from a restaurant with no staff: `data` is null, the loop
 *  runs zero times, and `notify()` returns `{ delivered: 0 }` as though there
 *  had been nobody to tell. No in-app row, no email, no push, and nothing in
 *  any log — for an order that was successfully placed and paid for.
 *
 *  Nothing here can be RECOVERED from a failed read, so the fix is not a
 *  retry: it is saying so. A notification system that goes quiet must never do
 *  it silently, because silence is exactly what it looks like when it is
 *  working and there is no news.
 * ─────────────────────────────────────────────────────────────────────────
 */
async function resolveRecipients(input: NotifyInput): Promise<Recipient[]> {
  const supabase = createAdminClient();
  const byId = new Map<string, Recipient>();
  const add = (r: Recipient) => byId.set(r.profileId, r);

  /** Log and carry on — a partial recipient list beats an unexplained none. */
  const report = (who: string, error: { message?: string } | null) => {
    if (error) console.error(`[notify] could not resolve ${who} —`, error.message ?? error);
  };

  if (input.restaurantId) {
    const { data, error } = await supabase
      .from("restaurant_staff")
      .select(
        `profile_id,
         profiles!restaurant_staff_profile_id_fkey ( id, name, email, status, deleted_at )`,
      )
      .eq("restaurant_id", input.restaurantId)
      .eq("status", "active");

    report(`staff of restaurant ${input.restaurantId}`, error);

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
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, status, deleted_at")
      .eq("id", input.customerId)
      .maybeSingle();

    report(`customer ${input.customerId}`, error);
    // A suspended account still needs to read "you were suspended" — only
    // the account event may reach one.
    const usable = data && !data.deleted_at && (data.status === "active" || (data.status === "suspended" && input.event === "account"));
    if (usable) {
      add({ profileId: data.id, name: data.name, email: data.email, kind: "customer" });
    }
  }

  if (input.admins) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email")
      .eq("role", "admin")
      .eq("status", "active")
      .is("deleted_at", null);

    report("admins", error);
    for (const row of (data ?? []) as { id: string; name: string; email: string }[]) {
      add({ profileId: row.id, name: row.name, email: row.email, kind: "admin" });
    }
  }

  if (input.profileId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, role, status, deleted_at")
      .eq("id", input.profileId)
      .maybeSingle();

    report(`profile ${input.profileId}`, error);
    const usable = data && !data.deleted_at && data.status === "active";
    if (usable) {
      const kind = data.role === "admin" ? "admin" : data.role === "manager" ? "manager" : "customer";
      add({ profileId: data.id, name: data.name, email: data.email, kind });
    }
  }

  if (input.roles?.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, role")
      .in("role", input.roles)
      .eq("status", "active")
      .is("deleted_at", null);

    report(`roles ${input.roles.join(", ")}`, error);
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
  order_delayed: "order_status",
  reservation_decision: "reservations",
  reservation_status: "reservations",
  reservation_reminder: "reservations",
  chat_reply: "messages",
  review_reply: "reviews",
  review_prompt: "reviews",
  loyalty: "loyalty",
  broadcast: "promotions",
};

/**
 * Which grid row governs each manager-facing event.
 *
 * The grid renders the catalogue in settings.ts; events used to fall through
 * to "all channels on" whenever their key was not literally a catalogue key —
 * which was every chat message, every settled invoice, every customer
 * response to an order. Mapped events are tunable; unmapped ones (approval,
 * account, broadcast) stay always-on deliberately: they are things happening
 * TO the account, not messages about the business.
 */
const MANAGER_PREF_KEY: Partial<Record<NotifyEvent, NotificationEventKey>> = {
  new_order: "new_order",
  order_cancelled: "order_cancelled",
  order_status: "order_updates",
  order_delayed: "order_updates",
  reservation: "reservation",
  review: "review",
  low_stock: "low_stock",
  billing: "billing",
  billing_paid: "billing",
  billing_refund: "billing",
  chat: "messages",
};

function managerDefaults(event: NotifyEvent): Channels {
  const key = MANAGER_PREF_KEY[event];
  const known = key ? NOTIFICATION_EVENTS.find((e) => e.key === key) : undefined;
  if (known) {
    return { inApp: known.inApp, email: known.email, push: known.push };
  }
  // Events outside the catalogue (approval, account, broadcasts…) default to
  // everything on.
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
      // The stored row lives under the GRID key, not the raw event name —
      // billing_paid is answered by the "billing" row, chat by "messages".
      const gridKey = MANAGER_PREF_KEY[input.event] ?? input.event;
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("profile_id, in_app, email, push")
        .eq("restaurant_id", input.restaurantId)
        .in("profile_id", managerIds)
        .eq("event_key", gridKey);
      // A failed read degrades everyone to the catalogue defaults — say so,
      // because that is people getting emails they turned off.
      if (error) console.error(`[notify] manager prefs read failed (${input.event}) —`, error.message);
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
      /*
        `push_enabled` IS DELIBERATELY NOT SELECTED. The column is missing
        from the live database (customer.ts documents the 42703 this causes),
        and PostgREST fails the WHOLE select over one absent column — which
        silently degraded every customer to topic defaults. Nothing needs it:
        readTopic only consults the legacy flag for bare-boolean rows, and
        `true` reproduces the pre-grid default exactly (customer.ts does the
        same).
      */
      const { data, error } = await supabase
        .from("customer_preferences")
        .select("profile_id, notification_json")
        .in("profile_id", customerIds);
      if (error) console.error(`[notify] customer prefs read failed (${input.event}) —`, error.message);
      for (const row of (data ?? []) as {
        profile_id: string;
        notification_json: unknown;
      }[]) {
        customerPrefs.set(row.profile_id, {
          notification_json: row.notification_json ?? {},
          push_enabled: true,
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

    /*
      Resolved once per event, not per recipient. The email link must be
      ABSOLUTE — a bare "/orders/abc" pasted into plain text is dead in every
      mail client — and the signature is the platform's configured name, not
      a hardcoded one. Both are cached upstream; failures fall back rather
      than block the delivery.
    */
    const [base, branding] = await Promise.all([
      siteUrl().catch(() => ""),
      getBranding().catch(() => null),
    ]);
    const brandName = branding?.name?.trim() || "Resto237";

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
      const recipientHref =
        href ??
        (input.event === "broadcast"
          ? recipient.kind === "manager"
            ? "/m/messages?tab=announcements"
            : recipient.kind === "customer"
              ? "/messages"
              : "/a/notifications"
          : null);
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
      /*
        Quiet hours and snooze gate ONLY the push — the wake-up. The bell row
        and the email still land, so nothing is lost, just not rung at 3am.
        Action-required and account events are exempt: see pushSuppressedFor.
      */
      const push =
        input.push !== false &&
        (input.channels?.push ?? prefs.push) &&
        !pushSuppressedFor(input.event, params, masterChannels.get(recipient.profileId));

      if (inApp) {
        inAppRows.push({
          profile_id: recipient.profileId,
          title: text.title,
          body: text.body,
          tone,
          href: recipientHref,
        });
      }
      if (email && recipient.email) {
        emails.push({
          to: recipient.email,
          subject: text.title,
          body: [text.title, "", text.body, href ? `${base}${href}` : "", "", `— ${brandName}`].join("\n"),
        });
      }
      if (push) {
        pushes.push({
          profileId: recipient.profileId,
          title: text.title,
          body: text.body,
          href: recipientHref,
          // Tone and language travel WITH the push now: when the banner is
          // announced by the service worker's postMessage (tab open, app
          // hidden), the toast used to always read as "info" because the
          // payload carried nothing else.
          tone,
          locale,
        });
      }
    }

    let inAppWritten = true;
    if (inAppRows.length > 0) {
      const { error } = await supabase.from("notifications").insert(inAppRows);
      if (error) {
        console.error("[notify] in-app insert failed", error.message);
        // The returned count must not vouch for rows that were never
        // written — the broadcast composer records it as a delivered figure.
        inAppWritten = false;
      }
    }

    /*
      ────────────────────────────────────────────────────────────────────
       THE COLLAPSE KEY IS PER SUBJECT, NOT PER EVENT TYPE.

       sw.js was already reading `data.tag` and the server sent none, so
       every push shared one tag and a new order replaced an unread chat
       reply on the lock screen. Keying it on the event fixed that and
       introduced a worse one: `restolink:new_order` is the SAME tag for
       every order, so three orders arriving while a phone is asleep
       collapse into one banner and the kitchen sees the last of them.
       Two missed orders, and nothing anywhere to say they existed.

       The reference is what makes a notification about THIS order
       distinct from one about the next. Distinct subjects now stack;
       two notifications about the same subject — an order confirmed and
       then out for delivery — still replace each other, which is the
       behaviour the tag is actually for.

       Events with no reference (a broadcast, "push is on") keep the
       event-level tag: there is only ever one of them in flight.
      ────────────────────────────────────────────────────────────────────
    */
    const tag = input.params?.reference
      ? `restolink:${input.event}:${input.params.reference}`
      : `restolink:${input.event}`;

    const payloadFor = (p: (typeof pushes)[number]): PushPayload => ({
      title: p.title,
      body: p.body,
      href: p.href,
      tag,
      tone: p.tone,
      lang: p.locale,
      requireInteraction: REQUIRE_INTERACTION_EVENTS.has(input.event),
      actions: pushActionsFor(input.event, params, p.href, p.locale),
      icon: branding?.iconUrl ?? "/app-icon-192.png",
      badge: "/notification-badge.png",
    });

    /*
      EMAIL AND PUSH RUN SIDE BY SIDE, NOT IN LINE. Email goes through a
      pooled SMTP transport three connections wide; a broadcast's pushes
      used to queue behind the whole mail run inside one lambda. Neither
      channel waits on the other now.
    */
    const emailTask = Promise.allSettled(
      emails.map((m) => trySendMail({ to: m.to, subject: m.subject, body: m.body })),
    );

    const pushTask =
      input.event === "new_order" && input.restaurantId
        ? deliverNewOrderPush(pushes, payloadFor, input.restaurantId, params)
        : Promise.allSettled(pushes.map((p) => sendPush(p.profileId, payloadFor(p)))).then(() => undefined);

    await Promise.all([emailTask, pushTask]);

    return { delivered: inAppWritten ? inAppRows.length : 0 };
  } catch (error) {
    // Never throw — see the file header.
    console.error("[notify] failed", input.event, error);
    return { delivered: 0 };
  }
}

/* ── Push-only refinements ─────────────────────────────────────────────── */

/**
 * Events a snooze or quiet-hours window must never silence: the order the
 * kitchen has not seen, the question that stops the kitchen, the account
 * being suspended, and the proof-of-push the person just asked for.
 */
const QUIET_EXEMPT_EVENTS: ReadonlySet<NotifyEvent> = new Set<NotifyEvent>([
  "new_order",
  "account",
  "push_enabled",
]);

/**
 * Should the PUSH stay quiet for this recipient right now? In-app and email
 * are untouched — this only decides whether a phone buzzes.
 *
 * Windows are minutes-since-midnight in Africa/Douala (UTC+1, no DST — the
 * same fixed offset checkout already anchors on). An overnight window
 * (start > end) wraps midnight. A recipient with no window still has one for
 * marketing: broadcasts default to quiet 21:00–07:00, because "opted in to
 * promotions" is not "wake me for them".
 */
function pushSuppressedFor(
  event: NotifyEvent,
  params: NotifyParams,
  master: NotificationChannels | undefined,
): boolean {
  if (QUIET_EXEMPT_EVENTS.has(event)) return false;
  // The fee question blocks the kitchen until answered — never suppressed.
  if (event === "order_status" && params.status === "awaiting_customer") return false;

  const now = new Date();
  if (master?.snoozedUntil && Date.parse(master.snoozedUntil) > now.getTime()) return true;

  const minutesInDouala = (now.getUTCHours() * 60 + now.getUTCMinutes() + 60) % 1440;
  const inWindow = (start: number, end: number) =>
    start <= end
      ? minutesInDouala >= start && minutesInDouala < end
      : minutesInDouala >= start || minutesInDouala < end;

  const start = master?.quietStart ?? null;
  const end = master?.quietEnd ?? null;
  if (start !== null && end !== null && start !== end) return inWindow(start, end);
  if (event === "broadcast") return inWindow(21 * 60, 7 * 60);
  return false;
}

/**
 * Buttons on the banner, per event. Every button is a DEEP LINK — the tap
 * opens the page where the real, authenticated, confirmed action lives.
 * No mutation ever happens from the notification itself.
 */
function pushActionsFor(
  event: NotifyEvent,
  params: NotifyParams,
  href: string | null,
  locale: Locale,
): PushPayload["actions"] {
  if (!href) return undefined;
  const fr = locale === "fr";

  switch (event) {
    case "new_order":
      return [{ action: "view", title: fr ? "Voir la commande" : "View order", href }];
    case "order_status":
      // The one push that asks a question gets its answers as buttons. The
      // links land on the order page with the choice preselected — the page
      // still asks for the confirming tap, signed in.
      if (params.status === "awaiting_customer") {
        return [
          { action: "fee-accept", title: fr ? "Accepter" : "Accept", href: `${href}?fee=accept` },
          { action: "fee-decline", title: fr ? "Refuser" : "Decline", href: `${href}?fee=decline` },
        ];
      }
      return undefined;
    case "chat":
    case "chat_reply":
      return [{ action: "open", title: fr ? "Répondre" : "Reply", href }];
    case "review_prompt":
      return [{ action: "rate", title: fr ? "Noter" : "Rate", href }];
    default:
      return undefined;
  }
}

interface QueuedPush {
  profileId: string;
  title: string;
  body: string;
  href: string | null;
  tone: NotifyTone;
  locale: Locale;
}

/**
 * new_order push, with the answer kept.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A NEW ORDER THAT REACHES ZERO DEVICES IS AN INCIDENT, NOT A LOG LINE.
 *
 *  Every other event is fire-and-forget, correctly. This one is the
 *  business: if no staff device at the branch accepted the push — every
 *  endpoint dead, or nobody ever subscribed — the order is waiting on an
 *  email nobody may open and a bell nobody is looking at. The platform is
 *  the only party who can still act (call the restaurant), so the admins
 *  are told, once per restaurant thanks to the collapse tag, through the
 *  broadcast passthrough (their events are always-on).
 * ─────────────────────────────────────────────────────────────────────────
 */
async function deliverNewOrderPush(
  pushes: QueuedPush[],
  payloadFor: (p: QueuedPush) => PushPayload,
  restaurantId: string,
  params: NotifyParams,
): Promise<void> {
  const results = await Promise.allSettled(
    pushes.map((p) => sendPushWithReport(p.profileId, payloadFor(p))),
  );

  const reports = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof sendPushWithReport>>> => r.status === "fulfilled")
    .map((r) => r.value);

  // Not configured / platform switch off is a chosen state, not an outage.
  if (reports.length === 0 || !reports.some((r) => r.configured && r.platformEnabled)) return;

  const anySent = reports.some((r) => r.devices.some((d) => d.status === "sent"));
  const anyUnknown = reports.some((r) => r.queryFailed);
  if (anySent || anyUnknown) return;

  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .maybeSingle();
    const name = (data as { name?: string } | null)?.name ?? restaurantId;

    await notify({
      event: "broadcast",
      tone: "error",
      admins: true,
      href: "/a/restaurants",
      // Collapse per restaurant: a dead branch alerts once per lock screen,
      // not once per order.
      params: {
        reference: `unreachable:${restaurantId}`,
        subject: `Restaurant unreachable by push — ${name}`,
        bodyText: `New order ${params.reference ?? ""} at ${name}: no staff device received the push. Staff may not know the order exists — call the restaurant.`,
      },
    });
  } catch (error) {
    console.error("[notify] unreachable-restaurant escalation failed", error);
  }
}
