"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/input";
import { SuperAdminOnlyHint, useIsSuperAdmin } from "@/components/layout/admin-shell";
import { useLocale } from "@/lib/i18n/use-locale";
import { saveEmailVerificationPolicy } from "@/lib/data/security-policy-actions";
import type { EmailVerificationPolicy } from "@/lib/auth/email-policy-rules";

const copy = {
  fr: { title: "Sécurité des comptes", intro: "Choisissez qui doit vérifier son adresse email pour utiliser son compte. Activé : vérification obligatoire. Désactivé : vérification facultative.", admin: "Administrateurs", manager: "Comptes restaurant", customer: "Clients", optional: "La 2FA reste facultative pour tout le monde. Chaque personne peut l’activer ou la désactiver depuis son profil.", save: "Enregistrer les règles", saved: "Règles de vérification enregistrées.", failed: "Impossible d’enregistrer. Réessayez.", access: "Les règles s’appliquent aux nouvelles inscriptions et aux comptes existants lors de leur prochain accès.", ownership: "Les invitations d’équipe et la récupération du mot de passe nécessitent toujours une preuve d’accès à l’adresse email." },
  en: { title: "Account security", intro: "Choose who must verify their email to use their account. On: verification required. Off: verification optional.", admin: "Administrators", manager: "Restaurant accounts", customer: "Customers", optional: "2FA stays optional for everyone. Each person can enable or disable it from their profile.", save: "Save verification rules", saved: "Email verification rules saved.", failed: "Could not save. Please try again.", access: "These rules apply to new signups and existing accounts on their next access.", ownership: "Team invitations and password recovery still require proof of access to the email address." },
};
export function SecurityPolicyPanel({ initial }: { initial: EmailVerificationPolicy }) {
  const { locale } = useLocale();
  const text = copy[locale];
  const canEdit = useIsSuperAdmin();
  const router = useRouter();
  const [policy, setPolicy] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const changed = (["admin", "manager", "customer"] as const).some(role => policy[role] !== saved[role]);
  return <section className="mb-6 space-y-4 rounded-xl border border-border bg-surface p-5">
    <h2 className="font-semibold">{text.title}</h2><p className="text-sm text-text-secondary">{text.intro}</p>
    <form onSubmit={e => { e.preventDefault(); setMessage(""); setError(""); start(async () => {
      try { const result = await saveEmailVerificationPolicy(policy); if (result.ok) { setSaved(policy); setMessage(text.saved); router.refresh(); } else setError(result.error); }
      catch { setError(text.failed); }
    }); }} className="space-y-4">
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        {(["admin", "manager", "customer"] as const).map(role => <Switch key={role} label={text[role]} checked={policy[role]} onChange={e => { setPolicy(previous => ({ ...previous, [role]: e.target.checked })); setMessage(""); }} />)}
      </fieldset>
      <p className="text-sm text-text-secondary">{text.access}</p><p className="text-sm text-text-secondary">{text.ownership}</p>
      <p className="text-sm text-text-secondary">{text.optional}</p>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" loading={pending} disabled={!canEdit || !changed}>{text.save}</Button>{!canEdit && <SuperAdminOnlyHint />}</div>
      {message && <p role="status" className="text-sm text-success">{message}</p>}{error && <p role="alert" className="text-sm text-error">{error}</p>}
    </form>
  </section>;
}
