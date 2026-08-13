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
  "kitchen.display",
  "menu.view",
  "menu.edit",
  "tables.view",
  "tables.manage",
  "reservations.view",
  "reservations.decide",
  "promotions.manage",
  "customers.view",
  "reviews.reply",
  "reports.view",
  "staff.manage",
  "billing.manage",
  "finance.manage",
  "profile.edit",
  "settings.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * ⚠️ OPEN QUESTION — see dev.md §4, question 1.
 *
 * §9 of explanation.md states the matrix is 20 capabilities × 5 branch roles.
 * §14.4 names only the 17 above. The remaining 3 must be READ OUT OF the PHP
 * `functions.php` matrix before P3 ships — inventing them silently grants or
 * withholds access that the old system did not.
 *
 * Until then this file is 17, and that gap is deliberate and visible rather
 * than papered over with three plausible guesses.
 */
export const KNOWN_CAPABILITY_COUNT = 18;
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
  kitchen: "Écran de cuisine et avancement des commandes.",
  cashier: "Commandes, encaissement et clients.",
  waiter: "Prise de commande en salle, tables et réservations.",
};

/**
 * PROVISIONAL. These assignments are a reasonable reading of the five roles,
 * not a port — the authoritative matrix is in PHP `functions.php` and must be
 * transcribed before P3. Getting this wrong in either direction is a security
 * bug: too generous grants access, too strict blocks a working restaurant
 * mid-service.
 */
const MATRIX: Record<BranchRole, Capability[]> = {
  owner: [...CAPABILITIES],

  // Everything except billing. The wallet is the restaurant's OWN money —
  // a manager may see it and request a withdrawal; plan changes stay with
  // the owner because they are a financial commitment.
  manager: CAPABILITIES.filter((c) => c !== "billing.manage"),

  kitchen: ["orders.view", "orders.advance", "kitchen.display", "menu.view"],

  cashier: [
    "orders.view",
    "orders.advance",
    "menu.view",
    "tables.view",
    "reservations.view",
    "customers.view",
  ],

  waiter: ["orders.view", "orders.advance", "menu.view", "tables.view", "reservations.view"],
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
  "kitchen.display": "Écran de cuisine",
  "menu.view": "Voir le menu",
  "menu.edit": "Modifier le menu",
  "tables.view": "Voir les tables",
  "tables.manage": "Gérer les tables",
  "reservations.view": "Voir les réservations",
  "reservations.decide": "Décider des réservations",
  "promotions.manage": "Gérer les promotions",
  "customers.view": "Voir les clients",
  "reviews.reply": "Répondre aux avis",
  "reports.view": "Voir les rapports",
  "staff.manage": "Gérer le personnel",
  "billing.manage": "Gérer la facturation",
  "finance.manage": "Voir le portefeuille et retirer",
  "profile.edit": "Modifier le profil",
  "settings.manage": "Gérer les paramètres",
};
