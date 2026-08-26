"use client";

import { useState } from "react";
import { MapPin, Search } from "lucide-react";
import { Badge, SectionTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardTitle, Panel } from "@/components/ui/card";
import { Checkbox, Field, Input, Radio, Select, Switch, Textarea } from "@/components/ui/input";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { formatMoney, formatMoneyCompact, formatPercent } from "@/lib/format/currency";
import { formatDateTime, formatElapsed, formatRelative } from "@/lib/format/datetime";
import { ORDER_STATUSES, ORDER_TYPES, orderStatusMeta } from "@/lib/format/order-status";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Living style guide. Not one of the 78 routes — it exists so the tokens,
 * primitives and formatters can be checked in both themes on one screen
 * instead of being discovered to be wrong on screen 60.
 */
export default function StyleguidePage() {
  const { toast } = useToast();
  const [invalid, setInvalid] = useState(false);

  const now = new Date("2026-08-03T20:00:00Z");
  const earlier = new Date("2026-08-03T19:18:00Z");

  return (
    <main id="main" className="container-page space-y-12 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <SectionTag>Style guide</SectionTag>
          <h1 className="mt-3 font-display text-4xl font-bold">Design system</h1>
          <p className="mt-1 text-text-secondary">
            Tokens, primitives et formateurs — vérifiés dans les deux thèmes.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {/* ── Colour ─────────────────────────────────────────────────────── */}
      <Panel title="Couleurs" description="Palette reprise de la page d'accueil PHP, plus les états sémantiques.">
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["bg-primary text-primary-fg", "primary"],
            ["bg-primary-light text-primary", "primary-light"],
            ["bg-accent text-accent-fg", "accent"],
            ["bg-success text-white", "success"],
            ["bg-warning text-white", "warning"],
            ["bg-info text-white", "info"],
            ["bg-error text-white", "error"],
            ["bg-surface text-text border border-border", "surface"],
            ["bg-surface-2 text-text border border-border", "surface-2"],
            ["bg-bg text-text border border-border", "bg"],
            ["bg-border text-text", "border"],
            ["bg-text text-bg", "text"],
          ].map(([cls, name]) => (
            <div key={name} className={`rounded-md p-4 text-xs font-semibold ${cls}`}>
              {name}
            </div>
          ))}
        </CardBody>
      </Panel>

      {/* ── Type ───────────────────────────────────────────────────────── */}
      <Panel title="Typographie" description="Playfair Display pour les titres, Inter pour le texte.">
        <CardBody className="space-y-3">
          <p className="font-display text-5xl font-bold">Commandez à Douala</p>
          <p className="font-display text-3xl font-bold italic text-primary">
            Réservez votre table
          </p>
          <p className="text-base text-text-secondary">
            Corps de texte en Inter. Les chiffres tabulaires alignent les colonnes :
            <span className="tnum ml-2 font-semibold text-text">12 500 · 8 000 · 145 000</span>
          </p>
          <p className="text-sm text-text-light">Texte secondaire, légendes et métadonnées.</p>
        </CardBody>
      </Panel>

      {/* ── Buttons ────────────────────────────────────────────────────── */}
      <Panel title="Boutons">
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button loading>Chargement</Button>
            <Button disabled>Désactivé</Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => toast("Commande confirmée", "success")}>Toast succès</Button>
            <Button variant="outline" onClick={() => toast("Paiement refusé", "error")}>
              Toast erreur
            </Button>
            <Button variant="outline" onClick={() => toast("Abonnement en période de grâce", "warning")}>
              Toast alerte
            </Button>
          </div>
        </CardBody>
      </Panel>

      {/* ── Badges + order status ──────────────────────────────────────── */}
      <Panel title="Badges et statuts de commande">
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["neutral", "primary", "accent", "success", "warning", "info", "error"] as BadgeTone[]).map(
              (tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ),
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Every status in every order type — the whole point of the
                style guide is that a pickup badge and a delivery badge can be
                compared side by side instead of discovered in production. */}
            {ORDER_TYPES.flatMap((type) =>
              ORDER_STATUSES.map((status) => {
                const meta = orderStatusMeta(status, type);
                return (
              <span
                key={`${type}-${status}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badge}`}
              >
                <span className={`size-1.5 rounded-full ${meta.dot}`} />
                {meta.labelKey}
              </span>
                );
              }),
            )}
          </div>
        </CardBody>
      </Panel>

      {/* ── Forms ──────────────────────────────────────────────────────── */}
      <Panel title="Formulaires">
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Recherche" htmlFor="sg-q" hint="Plat, restaurant ou cuisine">
            <Input id="sg-q" icon={<Search />} placeholder="Poulet DG…" />
          </Field>
          <Field label="Ville" htmlFor="sg-city">
            <Input id="sg-city" icon={<MapPin />} defaultValue="Douala" />
          </Field>
          <Field label="Montant" htmlFor="sg-amount">
            <Input id="sg-amount" suffix="FCFA" inputMode="numeric" defaultValue="12 500" />
          </Field>
          <Field label="Type" htmlFor="sg-type">
            <Select id="sg-type" defaultValue="delivery">
              <option value="delivery">Livraison</option>
              <option value="pickup">À emporter</option>
              <option value="dine_in">Sur place</option>
            </Select>
          </Field>
          <Field
            label="Email"
            htmlFor="sg-email"
            error={invalid ? "Cette adresse est invalide." : undefined}
            className="sm:col-span-2"
          >
            <Input id="sg-email" type="email" invalid={invalid} placeholder="vous@exemple.cm" />
          </Field>
          <Field label="Instructions" htmlFor="sg-notes" className="sm:col-span-2">
            <Textarea id="sg-notes" placeholder="Sans piment, sonner à l'entrée…" />
          </Field>
          <div className="space-y-2">
            <Checkbox name="sg-extras" label="Fromage supplémentaire" trailing="+500 FCFA" />
            <Checkbox name="sg-extras" label="Sauce piquante" trailing="+200 FCFA" defaultChecked />
          </div>
          <div className="space-y-2">
            <Radio name="sg-size" label="Petit" description="1 personne" defaultChecked />
            <Radio name="sg-size" label="Grand" description="2–3 personnes" trailing="+1 500 FCFA" />
          </div>
          <div className="space-y-3 sm:col-span-2">
            <Switch label="Notifications par email" description="Confirmations et rappels" defaultChecked />
            <Switch label="Mode sombre automatique" />
            <Button variant="outline" size="sm" onClick={() => setInvalid((v) => !v)}>
              Basculer l&apos;état d&apos;erreur
            </Button>
          </div>
        </CardBody>
      </Panel>

      {/* ── Formatters ─────────────────────────────────────────────────── */}
      <Panel title="Formateurs" description="XAF sans décimale, heures rendues en Africa/Douala.">
        <CardBody>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ["formatMoney(12500)", formatMoney(12500)],
              ["formatMoney(-3000)", formatMoney(-3000)],
              ["formatMoney(250, signed)", formatMoney(250, { signed: true })],
              ["formatMoneyCompact(1_450_000)", formatMoneyCompact(1450000)],
              ["formatPercent(3)", formatPercent(3)],
              ["formatDateTime(now)", formatDateTime(now)],
              ["formatRelative(earlier)", formatRelative(earlier, now)],
              ["formatElapsed(earlier)", formatElapsed(earlier, now)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
                <dt className="font-mono text-xs text-text-light">{label}</dt>
                <dd className="tnum font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Panel>

      {/* ── Surfaces ───────────────────────────────────────────────────── */}
      <Panel title="Surfaces et chargement">
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Card className="shadow-sm">
            <CardBody>
              <CardTitle>shadow-sm</CardTitle>
              <p className="mt-1 text-sm text-text-secondary">Cartes de liste.</p>
            </CardBody>
          </Card>
          <Card className="shadow-md">
            <CardBody>
              <CardTitle>shadow-md</CardTitle>
              <p className="mt-1 text-sm text-text-secondary">Survol, panneaux.</p>
            </CardBody>
          </Card>
          <Card className="shadow-lg">
            <CardBody>
              <CardTitle>shadow-lg</CardTitle>
              <p className="mt-1 text-sm text-text-secondary">Carte de recherche du hero.</p>
            </CardBody>
          </Card>
          <SkeletonCard />
          <div className="space-y-3">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-3/4" />
            <Skeleton className="h-11 w-1/2" />
          </div>
        </CardBody>
      </Panel>
    </main>
  );
}
