/**
 * The capability matrix — the client-side mirror (§9).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS FILE DECIDES WHAT CHROME TO RENDER. IT DECIDES NOTHING ELSE.
 *
 *  The server is authoritative. `lib/auth/rbac` (P3) re-checks every
 *  capability on every request, and a page that renders is not a page the
 *  user is allowed to act on. This copy exists so the sidebar does not show
 *  seventeen links that all 403.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Two-level permission model (§2): `users.role = 'manager'` says only "this
 * person works at a restaurant". Real permission comes from
 * `restaurant_staff.role`, PER BRANCH — one person can be `owner` at one
 * location and `waiter` at another. Never flatten this onto the user record.
 *
 * Pages check CAPABILITIES, never roles. Adding a role is then a data change
 * rather than an edit to every page.
 */

export const CAPABILITIES = [
  "orders.view",
  "orders.advance",
  "orders.cancel",
  "kitchen.display",
  "menu.view",
  "menu.edit",
  "menu.availability",
  "tables.view",
  "tables.manage",
  "reservations.view",
  "reservations.decide",
  "reservations.seat",
  "promotions.manage",
  "customers.view",
  "reviews.reply",
  "reports.view",
  "staff.manage",
  "billing.manage",
  "finance.manage",
  "payments.collect",
  "service.pause",
  "profile.edit",
  "settings.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * ⚠️ OPEN QUESTION — see dev.md §4, question 1.
 *
 * §9 of explanation.md states the matrix is 20 capabilities × 5 branch roles.
 * §14.4 names only 17. The PHP `functions.php` matrix was never transcribed,
 * so the list grew from how restaurants actually work instead (Sep 2026):
 * the five capabilities added then — orders.cancel, menu.availability,
 * reservations.seat, payments.collect, service.pause — each split a
 * mid-service gesture away from the back-office power it used to borrow.
 */
export const KNOWN_CAPABILITY_COUNT = CAPABILITIES.length;
export const EXPECTED_CAPABILITY_COUNT = 20;

export const BRANCH_ROLES = ["owner", "manager", "kitchen", "cashier", "waiter"] as const;
export type BranchRole = (typeof BRANCH_ROLES)[number];

export const BRANCH_ROLE_LABEL: Record<BranchRole, string> = {
  owner: "Propriétaire",
  manager: "Gérant",
  kitchen: "Cuisine",
  cashier: "Caissier",
  waiter: "Serveur",
};

export const BRANCH_ROLE_DESCRIPTION: Record<BranchRole, string> = {
  owner: "Accès complet, y compris la facturation et le personnel.",
  manager: "Gère le service, le menu et l'équipe. Pas la facturation.",
  kitchen: "Écran de cuisine, avancement des commandes et plats épuisés.",
  cashier: "Commandes, encaissement, tables et clients.",
  waiter: "Prise de commande en salle, tables, encaissement et réservations.",
};

/**
 * PROVISIONAL. These assignments are a reasonable reading of the five roles,
 * not a port — the authoritative matrix is in PHP `functions.php` and must be
 * transcribed before P3. Getting this wrong in either direction is a security
 * bug: too generous grants access, too strict blocks a working restaurant
 * mid-service.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE SEP 2026 SPLIT — SERVICE GESTURES NO LONGER BORROW BACK-OFFICE POWER.
 *
 *  Four things staff do dozens of times a night were each gated on a
 *  capability meant for something much bigger, so the people standing at
 *  the pass could not do them:
 *
 *    · closing a cash bill / asking a table to pay needed `finance.manage` —
 *      the WITHDRAWAL permission. A cashier could not take cash at a table,
 *      and the only way to let them was to let them empty the wallet.
 *      → `payments.collect`; `finance.manage` is withdrawals only now.
 *    · "we're out of Poulet DG" needed `menu.edit` — the power to reprice
 *      and delete dishes. The kitchen, who know first, could not say it.
 *      → `menu.availability`.
 *    · seating a party / marking a no-show / flipping a table's status
 *      needed `reservations.decide` or `tables.manage` — accepting bookings
 *      and redesigning the floor. The waiter at the door could not seat.
 *      → `reservations.seat`.
 *    · pausing orders needed `settings.manage`. → `service.pause`, still
 *      owner/manager only: a pause silently turns every customer away.
 *
 *  And one the other way: cancelling an order used to ride on
 *  `orders.advance`, so the kitchen tablet could cancel (and, from the new
 *  flow on, refund) a paid order. → `orders.cancel`, not held by kitchen.
 * ─────────────────────────────────────────────────────────────────────────
 */
const MATRIX: Record<BranchRole, Capability[]> = {
  owner: [...CAPABILITIES],

  // Everything except billing. The wallet is the restaurant's OWN money —
  // a manager may see it and request a withdrawal; plan changes stay with
  // the owner because they are a financial commitment.
  manager: CAPABILITIES.filter((c) => c !== "billing.manage"),

  // No orders.cancel: a cancellation now refunds the customer, and the pass
  // is not where that decision is made.
  kitchen: ["orders.view", "orders.advance", "kitchen.display", "menu.view", "menu.availability"],

  cashier: [
    "orders.view",
    "orders.advance",
    "orders.cancel",
    "menu.view",
    "menu.availability",
    "tables.view",
    "reservations.view",
    "reservations.seat",
    "customers.view",
    "payments.collect",
  ],

  // Waiters take the money at the table in most Douala restaurants, so they
  // can request payment and close a cash bill — never withdraw it.
  waiter: [
    "orders.view",
    "orders.advance",
    "menu.view",
    "tables.view",
    "reservations.view",
    "reservations.seat",
    "payments.collect",
  ],
};

const SETS: Record<BranchRole, Set<Capability>> = Object.fromEntries(
  BRANCH_ROLES.map((role) => [role, new Set(MATRIX[role])]),
) as Record<BranchRole, Set<Capability>>;

/** Does this branch role hold this capability? */
export function can(role: BranchRole, capability: Capability): boolean {
  return SETS[role].has(capability);
}

/** Does it hold at least one of these? Used for nav groups. */
export function canAny(role: BranchRole, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

export function capabilitiesFor(role: BranchRole): Capability[] {
  return MATRIX[role];
}

export const CAPABILITY_LABEL: Record<Capability, string> = {
  "orders.view": "Voir les commandes",
  "orders.advance": "Faire avancer les commandes",
  "orders.cancel": "Annuler les commandes",
  "kitchen.display": "Écran de cuisine",
  "menu.view": "Voir le menu",
  "menu.edit": "Modifier le menu",
  "menu.availability": "Marquer un plat épuisé",
  "tables.view": "Voir les tables",
  "tables.manage": "Gérer les tables",
  "reservations.view": "Voir les réservations",
  "reservations.decide": "Décider des réservations",
  "reservations.seat": "Installer les clients",
  "promotions.manage": "Gérer les promotions",
  "customers.view": "Voir les clients",
  "reviews.reply": "Répondre aux avis",
  "reports.view": "Voir les rapports",
  "staff.manage": "Gérer le personnel",
  "billing.manage": "Gérer la facturation",
  "finance.manage": "Voir le portefeuille et retirer",
  "payments.collect": "Encaisser à table",
  "service.pause": "Mettre le service en pause",
  "profile.edit": "Modifier le profil",
  "settings.manage": "Gérer les paramètres",
};
