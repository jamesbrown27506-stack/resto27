"use client";

import { useState, useTransition } from "react";
import { Globe, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createQuartier,
  createServiceArea,
  deleteQuartier,
  deleteServiceArea,
  setAreaAcceptingSignups,
  setQuartierActive,
  updateServiceArea,
} from "@/lib/data/admin-actions";
import type { AdminServiceArea } from "@/lib/data/admin";
import { cn } from "@/lib/utils";

const COUNTRIES = [
  { code: "CM", label: "Cameroon", currency: "XAF", timezone: "Africa/Douala" },
  { code: "GA", label: "Gabon", currency: "XAF", timezone: "Africa/Libreville" },
  { code: "CI", label: "Côte d'Ivoire", currency: "XOF", timezone: "Africa/Abidjan" },
  { code: "SN", label: "Senegal", currency: "XOF", timezone: "Africa/Dakar" },
];

type ActionFn = () => Promise<{ ok: boolean; error?: string }>;

export function AreasList({ areas }: { areas: AdminServiceArea[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState<AdminServiceArea | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingArea, setDeletingArea] = useState<AdminServiceArea | null>(null);

  // Form state for the create/edit sheet.
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("CM");
  const [currency, setCurrency] = useState("XAF");
  const [timezone, setTimezone] = useState("Africa/Douala");
  const [accepting, setAccepting] = useState(false);

  // One in-flight "add neighbourhood" input per area card.
  const [newQuartier, setNewQuartier] = useState<Record<string, string>>({});

  function act(fn: ActionFn, success: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast(success, "success");
      else toast(result.error ?? "Something went wrong.", "error");
    });
  }

  function openCreate() {
    setCity("");
    setCountry("CM");
    setCurrency("XAF");
    setTimezone("Africa/Douala");
    setAccepting(false);
    setCreating(true);
  }

  function openEdit(area: AdminServiceArea) {
    setCity(area.city);
    setCountry(area.country);
    setCurrency(area.currency);
    setTimezone(area.timezone);
    setEditing(area);
  }

  /** Country drives currency and timezone — they are not free choices. */
  function pickCountry(code: string) {
    setCountry(code);
    const match = COUNTRIES.find((c) => c.code === code);
    if (match) {
      setCurrency(match.currency);
      setTimezone(match.timezone);
    }
  }

  function submit() {
    const payload = { city, country, currency, timezone };
    if (editing) {
      const id = editing.id;
      setEditing(null);
      act(() => updateServiceArea(id, payload), `${city} updated.`);
    } else {
      setCreating(false);
      act(() => createServiceArea({ ...payload, acceptingSignups: accepting }), `${city} created.`);
    }
  }

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Button onClick={openCreate} disabled={pending}>
          <Plus className="size-4" aria-hidden />
          <span>New service area</span>
        </Button>
      </div>

      {areas.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MapPin />}
            title="No service areas"
            description="Add the first city you operate in."
            action={<Button onClick={openCreate}>Add a service area</Button>}
          />
        </Card>
      ) : (
        <ul className="grid gap-5 lg:grid-cols-2">
          {areas.map((area) => (
            <li key={area.id}>
              <Card>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-display text-xl font-bold">
                        <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
                        <span className="truncate">{area.city}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-text-secondary">
                        {area.country} · {area.currency} · {area.restaurantCount} restaurant
                        {area.restaurantCount === 1 ? "" : "s"}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-text-light">{area.timezone}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Badge tone={area.acceptingSignups ? "success" : "neutral"}>
                        {area.acceptingSignups ? "Open" : "Closed"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${area.city}`}
                        disabled={pending}
                        onClick={() => openEdit(area)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${area.city}`}
                        disabled={pending || area.restaurantCount > 0}
                        title={
                          area.restaurantCount > 0
                            ? "Move its restaurants out before deleting"
                            : undefined
                        }
                        className="text-error hover:bg-error-light"
                        onClick={() => setDeletingArea(area)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  {/* ── Neighbourhoods ─────────────────────────────────── */}
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-text-light uppercase">
                      Neighbourhoods ({area.quartiers.length})
                    </p>

                    {area.quartiers.length === 0 ? (
                      <p className="text-sm text-text-light">None yet.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {area.quartiers.map((q) => (
                          <li
                            key={q.id}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                              q.isActive
                                ? "border-border bg-surface-2"
                                : "border-warning/40 bg-warning-light text-warning line-through",
                            )}
                          >
                            <button
                              type="button"
                              disabled={pending}
                              title={q.isActive ? "Deactivate" : "Reactivate"}
                              onClick={() =>
                                act(
                                  () => setQuartierActive(q.id, !q.isActive),
                                  q.isActive ? `${q.name} deactivated.` : `${q.name} reactivated.`,
                                )
                              }
                              className="font-medium"
                            >
                              {q.name}
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              aria-label={`Delete ${q.name}`}
                              onClick={() =>
                                act(() => deleteQuartier(q.id), `${q.name} deleted.`)
                              }
                              className="text-text-light transition-colors hover:text-error"
                            >
                              <X className="size-3" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = (newQuartier[area.id] ?? "").trim();
                        if (!name) return;
                        setNewQuartier((prev) => ({ ...prev, [area.id]: "" }));
                        act(() => createQuartier(area.id, name), `${name} added.`);
                      }}
                    >
                      <Input
                        value={newQuartier[area.id] ?? ""}
                        onChange={(e) =>
                          setNewQuartier((prev) => ({ ...prev, [area.id]: e.target.value }))
                        }
                        placeholder="Add a neighbourhood…"
                        aria-label={`Add a neighbourhood to ${area.city}`}
                        className="h-9 flex-1 text-sm"
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={pending || !(newQuartier[area.id] ?? "").trim()}
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </Button>
                    </form>
                  </div>

                  <div className="mt-4 border-t border-border pt-4">
                    <Switch
                      label="Accepting signups"
                      description="Restaurants in this city can create an account."
                      checked={area.acceptingSignups}
                      disabled={pending}
                      onChange={(e) =>
                        act(
                          () => setAreaAcceptingSignups(area.id, e.target.checked),
                          e.target.checked
                            ? `Signups open for ${area.city}.`
                            : `Signups closed for ${area.city}.`,
                        )
                      }
                    />
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 flex max-w-2xl items-start gap-2.5 rounded-md border border-border bg-surface-2 p-4 text-sm text-text-secondary">
        <Globe className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          Timestamps are stored in UTC and rendered in each area&apos;s timezone. Opening an area in
          another country also means another currency — amounts are stored as whole minor units
          alongside the currency they belong to. Deactivating a neighbourhood hides it from new
          signups while leaving existing restaurants untouched.
        </span>
      </p>

      {/* ── Create / edit ──────────────────────────────────────────────── */}
      <Sheet
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.city}` : "New service area"}
        footer={
          <div className="flex gap-3">
            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button fullWidth disabled={city.trim().length < 2} onClick={submit}>
              {editing ? "Save changes" : "Create area"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <Field label="City" htmlFor="area-city" required>
            <Input
              id="area-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Yaoundé"
            />
          </Field>

          <Field
            label="Country"
            htmlFor="area-country"
            required
            hint="Sets the default currency and timezone."
          >
            <Select id="area-country" value={country} onChange={(e) => pickCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Currency" htmlFor="area-currency" required>
            <Select
              id="area-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="XAF">XAF — Central African CFA franc</option>
              <option value="XOF">XOF — West African CFA franc</option>
            </Select>
          </Field>

          <Field
            label="Timezone"
            htmlFor="area-tz"
            required
            hint="Times are stored in UTC and displayed in this zone."
          >
            <Select id="area-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {["Africa/Douala", "Africa/Libreville", "Africa/Abidjan", "Africa/Dakar"].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>

          {!editing && (
            <Switch
              label="Open signups immediately"
              description="You can turn this on later."
              checked={accepting}
              onChange={(e) => setAccepting(e.target.checked)}
            />
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={deletingArea !== null}
        onClose={() => setDeletingArea(null)}
        onConfirm={() => {
          const area = deletingArea;
          setDeletingArea(null);
          if (area) act(() => deleteServiceArea(area.id), `${area.city} deleted.`);
        }}
        title={`Delete ${deletingArea?.city ?? ""}?`}
        message="Its neighbourhoods are deleted with it. This is refused if any restaurant is still assigned to the area."
        confirmLabel="Delete area"
        destructive
      />
    </>
  );
}
