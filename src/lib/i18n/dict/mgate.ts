import { defineDict } from "../define";

/**
 * The plan-gate screens (a shared "upgrade" prompt).
 *
 * Shown by /m/reports, /m/reservations and /m/staff when the tenant's plan
 * does not include the feature — and suppressed entirely while the platform
 * is in free mode. The copy leans into what the tenant is missing rather
 * than what they have: "unlock" language, not "you are blocked" language.
 *
 * OWNED BY THE GATE, not by any single screen: every page that gates a
 * feature pastes the same prompt, so the tone stays the same everywhere.
 *
 * Prefix every key with `mgate.`.
 */
export const mgateDict = defineDict({
  fr: {
    "mgate.title": "{feature} est une fonctionnalité {plan}",
    "mgate.body":
      "Votre formule Starter ne l'inclut pas. Passez à {plan} pour débloquer {feature} — et profiter de toutes les fonctionnalités premium.",
    "mgate.cta": "Voir les formules",

    "mgate.feature.reservations": "Les réservations de tables",
    "mgate.feature.reports": "Les rapports et l'analytique",
    "mgate.feature.staff": "La gestion du personnel",

    "mgate.plan.professional": "Professional",
    "mgate.plan.enterprise": "Enterprise",
  },
  en: {
    "mgate.title": "{feature} is a {plan} feature",
    "mgate.body":
      "Your Starter plan does not include it. Upgrade to {plan} to unlock {feature} — and every other premium feature.",
    "mgate.cta": "See the plans",

    "mgate.feature.reservations": "Table reservations",
    "mgate.feature.reports": "Reports and analytics",
    "mgate.feature.staff": "Staff management",

    "mgate.plan.professional": "Professional",
    "mgate.plan.enterprise": "Enterprise",
  },
});