"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChefHat, Plus, Table2, Users, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { completeSetup, seedPopularDishes, upsertTable } from "@/lib/data/manager-actions";
import { POPULAR_DISHES } from "@/lib/data/dish-templates";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/data/manager";

const SUGGESTED = [
  { number: "1", capacity: 5 },
  { number: "2", capacity: 5 },
];

/**
 * The first-login setup wizard.
 *
 * Two steps, deliberately few choices:
 *
 *   1. TABLES — the suggested setup (2 × 5 seats, the most common layout)
 *      is one tap, and the custom form is right there for the floor that
 *      already knows itself. `canCreateTables` is false for waiters: they
 *      can skip and finish, their manager seeds the tables later.
 *
 *   2. CATEGORIES — the four defaults already exist (created lazily by
 *      ensureDefaultCategories on the first /m/menu visit), so this step is
 *      confirmation, not creation. Knowing the menu is not empty of
 *      structure before they first open it saves a confused look.
 *
 *   3. POPULAR DISHES — one tap starts the menu with the Cameroonian
 *      classics the restaurant actually serves (see dish-templates.ts).
 *      Every dish is a COPY in the restaurant's own menu_items; ticking
 *      none is a legitimate choice and the menu simply starts empty.
 *
 * Finishing stamps `setup_done_at`; the dashboard opens from then on.
 * The wizard is not a modal over the dashboard — it IS the dashboard until
 * setup is done, which is why the whole thing renders on its own page.
 */
export function SetupWizard({
  restaurantName,
  userName,
  tables: initialTables,
  categories,
  canCreateTables,
}: {
  restaurantName: string;
  userName: string;
  tables: RestaurantTable[];
  categories: string[];
  canCreateTables: boolean;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [tables, setTables] = useState(initialTables);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const [number, setNumber] = useState("");
  const [capacity, setCapacity] = useState("5");
  const [selectedDishes, setSelectedDishes] = useState<Set<string>>(new Set());

  const stepCount = 3;

  const allSelected = selectedDishes.size === POPULAR_DISHES.length;

  function addTable(number: string, capacity: number) {
    startTransition(async () => {
      setBusy(true);
      const result = await upsertTable({ number, capacity });
      setBusy(false);
      if (!result.ok) return toast(result.error, "error");
      // The list is local state and does not re-initialise on refresh, so it
      // grows HERE; router.refresh() keeps the server side of the story
      // current for the pages navigated to afterwards.
      setTables((prev) => [
        ...prev,
        { id: crypto.randomUUID(), number, capacity, status: "available", activePartySize: null },
      ]);
      router.refresh();
      toast(t("stp.tables.suggest.added"), "success");
    });
  }

  function addSuggested() {
    // Two sequential saves; both must land for the suggestion to be honest.
    addTable(SUGGESTED[0]!.number, SUGGESTED[0]!.capacity);
  }

  function submitCustom(e: React.FormEvent) {
    e.preventDefault();
    const seats = Number(capacity);
    if (!number.trim()) return toast(t("stp.tableRequired"), "error");
    if (!Number.isInteger(seats) || seats < 1) return toast(t("stp.seatsInvalid"), "error");
    addTable(number.trim(), seats);
    setNumber("");
  }

  function toggleDish(id: string) {
    setSelectedDishes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function finish() {
    startTransition(async () => {
      setBusy(true);
      const seed = await seedPopularDishes([...selectedDishes]);
      if (!seed.ok) {
        setBusy(false);
        return toast(seed.error, "error");
      }
      const result = await completeSetup();
      setBusy(false);
      if (!result.ok) return toast(result.error, "error");
      toast(t("stp.done"), "success");
      router.push("/m");
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-light text-primary">
          <ChefHat className="size-7" aria-hidden />
        </div>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("stp.title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t("stp.subtitle")}</p>
        <p className="mt-4 text-xs font-semibold tracking-wide text-text-light uppercase">
          {t("stp.step", { step: step + 1, total: stepCount })}
        </p>
      </div>

      {/* Progress dots */}
      <div className="mb-8 flex justify-center gap-2" aria-hidden>
        {Array.from({ length: stepCount }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2 rounded-full transition-all",
              i === step ? "w-8 bg-primary" : i < step ? "w-2 bg-primary/40" : "w-2 bg-border",
            )}
          />
        ))}
      </div>

      {step === 0 && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Table2 className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{t("stp.tables.title")}</h2>
              <p className="text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.tables.body")}</p>

          {canCreateTables ? (
            <>
              <div className="mt-5 rounded-lg border border-dashed border-border bg-surface-2/60 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-primary" aria-hidden />
                  {t("stp.tables.suggest.title")}
                </h3>
                <p className="mt-1 text-sm text-text-secondary">{t("stp.tables.suggest.body")}</p>
                <Button
                  type="button"
                  className="mt-3"
                  disabled={busy || tables.length > 0}
                  onClick={addSuggested}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("stp.tables.suggest.add")}
                </Button>
              </div>

              <form onSubmit={submitCustom} className="mt-5 grid grid-cols-[1fr_auto] gap-3">
                <Field label={t("stp.tableNumber")} className="min-w-0">
                  <Input
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder="3"
                    inputMode="numeric"
                  />
                </Field>
                <Field label={t("stp.tableCapacity")} className="min-w-0">
                  <Input
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    placeholder="5"
                    inputMode="numeric"
                  />
                </Field>
                <Button type="submit" variant="outline" disabled={busy} className="col-span-2">
                  <Plus className="size-4" aria-hidden />
                  {t("stp.tables.add")}
                </Button>
              </form>
            </>
          ) : (
            <p className="mt-4 rounded-lg bg-surface-2/60 p-3 text-sm text-text-secondary">
              {t("stp.tables.noRights")}
            </p>
          )}

          {tables.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold tracking-wide text-text-light uppercase">
                {t("stp.tables.list")}
              </h3>
              <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {tables.map((table) => (
                  <li
                    key={table.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{table.number}</span>
                    <span className="text-text-light">
                      {t("mt.seatsShort", { count: table.capacity })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(1)}>
              {t("stp.skip")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setStep(1)}>
              {t("stp.tables.continue")}
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Check className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{t("stp.categories.title")}</h2>
              <p className="text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.categories.body")}</p>

          <ul className="mt-4 flex flex-wrap gap-2">
            {categories.map((name) => (
              <li
                key={name}
                className="rounded-full border border-border bg-surface-2/60 px-3 py-1.5 text-sm font-medium"
              >
                {name}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(0)}>
              {"←"}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setStep(2)}>
              {t("stp.categories.continue")}
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <UtensilsCrossed className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{t("stp.dishes.title")}</h2>
              <p className="text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.dishes.body")}</p>

          <div className="mt-5 flex items-center gap-2">
            <Button
              type="button"
              variant={allSelected ? "outline" : "primary"}
              size="sm"
              disabled={busy}
              onClick={() =>
                setSelectedDishes(allSelected ? new Set() : new Set(POPULAR_DISHES.map((d) => d.id)))
              }
            >
              {allSelected ? t("stp.dishes.clear") : t("stp.dishes.selectAll")}
            </Button>
            <span className="ml-auto text-sm font-semibold text-primary">
              {selectedDishes.size}/{POPULAR_DISHES.length}
            </span>
          </div>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {POPULAR_DISHES.map((dish) => {
              const checked = selectedDishes.has(dish.id);
              return (
                <li key={dish.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      checked
                        ? "border-primary bg-primary-light/60"
                        : "border-border bg-surface-2/40 hover:border-primary/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDish(dish.id)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">{dish.name}</span>
                        <span className="tnum shrink-0 text-xs font-bold text-primary">
                          {formatMoney(dish.price)}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-text-secondary">
                        {dish.description}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(1)}>
              {"←"}
            </Button>
            <Button type="button" disabled={busy} loading={busy} onClick={finish}>
              {selectedDishes.size > 0
                ? t("stp.dishes.add", { count: selectedDishes.size })
                : t("stp.categories.done")}
            </Button>
          </div>
        </section>
      )}

      <p className="mt-8 text-center text-xs text-text-light">{userName}</p>
    </div>
  );
}