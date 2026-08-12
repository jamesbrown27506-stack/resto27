"use client";

import { useState } from "react";
import { Info, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { AccountShell } from "@/components/layout/account-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  deleteOwnAddress,
  saveOwnAddress,
  updateOwnAddress,
} from "@/lib/data/customer-actions";
import type { CustomerAddress } from "@/lib/data/customer";
import type { SessionUser } from "@/lib/session";

interface Draft {
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  quartier: string;
  landmark: string;
  isDefault: boolean;
}

const EMPTY_DRAFT: Draft = {
  label: "",
  recipientName: "",
  phone: "",
  addressLine: "",
  quartier: "",
  landmark: "",
  isDefault: false,
};

export function AddressesClient({
  user,
  initial,
  quartiers,
}: {
  user: SessionUser;
  initial: CustomerAddress[];
  quartiers: string[];
}) {
  const { toast } = useToast();

  const [addresses, setAddresses] = useState(initial);
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setDraft({ ...EMPTY_DRAFT, recipientName: user.name ?? "", phone: user.phone ?? "" });
    setSheetOpen(true);
  }

  function openEdit(address: CustomerAddress) {
    setEditing(address);
    setDraft({
      label: address.label,
      recipientName: address.recipientName ?? "",
      phone: address.phone ?? "",
      addressLine: address.addressLine,
      quartier: address.quartier,
      landmark: address.landmark ?? "",
      isDefault: address.isDefault,
    });
    setSheetOpen(true);
  }

  async function save() {
    if (!draft.label.trim() || !draft.recipientName.trim() || !draft.phone.trim() || !draft.addressLine.trim() || !draft.quartier) {
      toast("Vérifiez les champs obligatoires.", "error");
      return;
    }

    setBusy(true);
    const input = {
      label: draft.label,
      recipientName: draft.recipientName,
      phone: draft.phone,
      addressLine: draft.addressLine,
      quartierName: draft.quartier,
      landmark: draft.landmark,
      isDefault: draft.isDefault,
    };

    const result = editing
      ? await updateOwnAddress(editing.id, input)
      : await saveOwnAddress(input);
    setBusy(false);

    if (result.ok) {
      setSheetOpen(false);
      toast(editing ? "Adresse mise à jour." : "Adresse ajoutée.", "success");
    } else {
      toast(result.error, "error");
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setBusy(true);
    const result = await deleteOwnAddress(deleteId);
    setBusy(false);
    if (result.ok) {
      setAddresses((c) => c.filter((a) => a.id !== deleteId));
      toast("Adresse supprimée.", "info");
    } else {
      toast(result.error, "error");
    }
    setDeleteId(null);
  }

  return (
    <AccountShell
      user={user}
      title="Adresses"
      description="Vos adresses de livraison enregistrées."
      action={
        <Button onClick={openNew}>
          <Plus className="size-4" aria-hidden />
          Nouvelle adresse
        </Button>
      }
    >
      {/*
        §14.3 — editing an address NEVER rewrites a past order. Orders carry
        their own copy of the delivery details (§3), so this list is only ever
        the starting point for the next order.
      */}
      <p className="mb-5 flex items-start gap-2.5 rounded-md border border-info/25 bg-info-light p-3 text-sm text-info">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Modifier une adresse ici ne change rien à vos commandes déjà passées : chacune conserve
          l&apos;adresse telle qu&apos;elle était au moment de la commande.
        </span>
      </p>

      {addresses.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<MapPin />}
            title="Aucune adresse enregistrée"
            description="Ajoutez-en une pour aller plus vite au moment de commander."
            action={<Button onClick={openNew}>Ajouter une adresse</Button>}
          />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex flex-col rounded-lg border border-border bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    {address.label}
                    {address.isDefault && <Badge tone="primary">Par défaut</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">{address.recipientName}</p>
                </div>
                <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
              </div>

              <address className="mt-3 flex-1 text-sm leading-relaxed text-text-secondary not-italic">
                {address.addressLine}
                <span className="block">{address.quartier}, Douala</span>
                {address.landmark && (
                  <span className="block text-text-light">{address.landmark}</span>
                )}
                <span className="tnum mt-1 block">{address.phone}</span>
              </address>

              <div className="mt-4 flex gap-2 border-t border-border pt-3">
                <Button variant="ghost" size="sm" onClick={() => openEdit(address)}>
                  <Pencil className="size-3.5" aria-hidden />
                  Modifier
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-error hover:bg-error-light"
                  onClick={() => setDeleteId(address.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Supprimer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? "Modifier l'adresse" : "Nouvelle adresse"}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={() => setSheetOpen(false)}>
              Annuler
            </Button>
            <Button fullWidth disabled={busy} onClick={save}>
              Enregistrer
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Libellé" htmlFor="ad-label" required hint="Domicile, Bureau…">
            <Input
              id="ad-label"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Domicile"
            />
          </Field>

          <Field label="Nom du destinataire" htmlFor="ad-name" required>
            <Input
              id="ad-name"
              value={draft.recipientName}
              onChange={(e) => setDraft({ ...draft, recipientName: e.target.value })}
            />
          </Field>

          <Field label="Téléphone" htmlFor="ad-phone" required>
            <Input
              id="ad-phone"
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="+237 6 99 12 34 56"
            />
          </Field>

          <Field label="Quartier" htmlFor="ad-quartier" required>
            <Select
              id="ad-quartier"
              value={draft.quartier}
              onChange={(e) => setDraft({ ...draft, quartier: e.target.value })}
            >
              <option value="" disabled>
                Choisir un quartier
              </option>
              {quartiers.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Adresse" htmlFor="ad-line" required>
            <Input
              id="ad-line"
              value={draft.addressLine}
              onChange={(e) => setDraft({ ...draft, addressLine: e.target.value })}
              placeholder="Rue, immeuble, étage"
            />
          </Field>

          <Field
            label="Point de repère"
            htmlFor="ad-landmark"
            hint="Souvent plus utile que l'adresse elle-même pour le livreur."
          >
            <Input
              id="ad-landmark"
              value={draft.landmark}
              onChange={(e) => setDraft({ ...draft, landmark: e.target.value })}
              placeholder="En face de la pharmacie du Golfe"
            />
          </Field>

          <Switch
            label="Adresse par défaut"
            description="Pré-sélectionnée lors de vos prochaines commandes."
            checked={draft.isDefault}
            onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
          />
        </div>
      </Sheet>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Supprimer cette adresse ?"
        message="Vos commandes passées ne sont pas affectées — elles conservent leur propre copie de l'adresse."
        confirmLabel="Supprimer"
        destructive
      />
    </AccountShell>
  );
}