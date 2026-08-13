"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { PushToggle } from "@/components/notifications/push-toggle";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { TypedConfirmDialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { deleteOwnAccount, saveOwnPreferences } from "@/lib/data/customer-actions";
import type { CustomerPreferences } from "@/lib/data/customer";
import type { SessionUser } from "@/lib/session";

const NOTIFICATIONS: {
  key: keyof CustomerPreferences;
  label: string;
  description: string;
  defaultOn: boolean;
  locked: boolean;
}[] = [
  {
    key: "orderStatus",
    label: "Statut de mes commandes",
    description: "Confirmation, préparation, livraison.",
    defaultOn: true,
    /** Cannot be turned off — it is the order itself, not marketing. */
    locked: true,
  },
  {
    key: "reservations",
    label: "Réservations",
    description: "Confirmation ou refus de vos demandes de table.",
    defaultOn: true,
    locked: false,
  },
  {
    key: "loyalty",
    label: "Points de fidélité",
    description: "Quand vous gagnez ou utilisez des points.",
    defaultOn: true,
    locked: false,
  },
  {
    key: "promotions",
    label: "Offres et promotions",
    description: "Codes promo et nouveautés des restaurants que vous suivez.",
    defaultOn: false,
    locked: false,
  },
];

export function SettingsClient({
  user,
  initial,
}: {
  user: SessionUser;
  initial: CustomerPreferences;
}) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState(initial);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await saveOwnPreferences({
      ...prefs,
      orderStatus: true,
    });
    setBusy(false);
    if (result.ok) toast("Préférences enregistrées.", "success");
    else toast(result.error, "error");
  }

  async function confirmDelete() {
    setBusy(true);
    const result = await deleteOwnAccount();
    setBusy(false);
    if (result.ok) {
      toast("Votre compte a été supprimé. Au revoir.", "info");
      window.location.assign("/");
    } else {
      toast(result.error, "error");
      setDeleteOpen(false);
    }
  }

  return (
    <AccountShell
      user={user}
      title="Paramètres"
      description="Notifications, apparence et gestion du compte."
    >
      <div className="flex flex-col gap-6">
        <Panel title="Apparence">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium">Thème</p>
              <p className="mt-0.5 text-sm text-text-secondary">
                Clair, sombre, ou suivre les réglages de votre appareil.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </Panel>

        <Panel title="Notifications sur cet appareil">
          <div className="p-5">
            <PushToggle tPrefix="cst" />
          </div>
        </Panel>

        <Panel
          title="Notifications par email"
          description="Les messages liés à une commande en cours sont toujours envoyés."
        >
          <div className="flex flex-col gap-5 p-5">
            {NOTIFICATIONS.map((n) => (
              <Switch
                key={n.key}
                label={n.label}
                description={
                  n.locked ? `${n.description} Non désactivable.` : n.description
                }
                checked={prefs[n.key]}
                disabled={n.locked}
                onChange={(e) => setPrefs({ ...prefs, [n.key]: e.target.checked })}
              />
            ))}
          </div>
          <div className="border-t border-border p-5">
            <Button disabled={busy} onClick={save}>
              Enregistrer
            </Button>
          </div>
        </Panel>

        {/*
          §14.3 + hard rule #7 — deletion ANONYMISES, it does not delete.
          Removing the rows would destroy the restaurant's sales history and
          the platform's commission record. The copy says so plainly rather
          than promising an erasure we will not perform.
        */}
        <Panel title="Supprimer mon compte" description="Action définitive.">
          <div className="p-5">
            <div className="flex items-start gap-3 rounded-md border border-error/25 bg-error-light p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-error">Ce qui se passe exactement</p>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-text-secondary">
                  <li>
                    Votre nom, votre email et votre téléphone sont définitivement anonymisés.
                  </li>
                  <li>Vous ne pouvez plus vous connecter et vos points sont perdus.</li>
                  <li>
                    Vos commandes passées sont conservées sous forme anonyme : elles font partie de
                    la comptabilité des restaurants et ne peuvent pas être effacées.
                  </li>
                </ul>
              </div>
            </div>

            <Button
              variant="danger"
              className="mt-5"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              Supprimer mon compte
            </Button>
          </div>
        </Panel>
      </div>

      <TypedConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Supprimer définitivement votre compte"
        message="Vos données personnelles seront anonymisées et vous ne pourrez plus vous connecter. Vos commandes passées restent dans la comptabilité des restaurants, sans lien avec votre identité."
        phrase="SUPPRIMER"
        confirmLabel="Supprimer mon compte"
        hint="Cette action ne peut pas être annulée."
      />
    </AccountShell>
  );
}