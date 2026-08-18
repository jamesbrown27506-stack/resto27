"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, Bike, Check, ChefHat, Clock, Plus, Table2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  completeSetup,
  seedPopularDishes,
  setRestaurantDeposit,
  setDeliveryMode,
  setDefaultOpeningHours,
  upsertTable,
} from "@/lib/data/manager-actions";
import { POPULAR_DISHES } from "@/lib/data/dish-templates";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/data/manager";
import type { ActionResult } from "@/lib/data/admin-actions";

const SUGGESTED = [
  { number: "1", capacity: 5 },
  { number: "2", capacity: 5 },
];

type FeeType = "none" | "fixed";

/**
 * The first-login setup wizard.
 *
 * Five steps, deliberately few choices:
 *
 *   1. TABLES — the suggested setup (2 × 5 seats, the most common layout)
 *      is one tap, and the custom form is right there for the floor that
 *      already knows itself. `canCreateTables` is false for waiters: they
 *      can skip and finish, their manager seeds the tables later.
 *
 *   2. DELIVERY — does the restaurant have its own delivery riders?
 *      If yes: they handle delivery and set fees. If no: the platform
 *      manages delivery and the admin sets the fee.
 *
 *   3. OPENING HOURS — pre-filled Mon–Sat 10h–22h, shown for awareness.
 *      The manager can adjust later from /m/profile.
 *
 *   4. MENU — the four default categories and the popular-dishes picker on
 *      one screen, so the card is set up in a single step. Categories are a
 *      confirmation (ensureDefaultCategories creates the defaults lazily);
 *      each ticked dish is a COPY in the restaurant's own menu_items, and
 *      ticking none is a legitimate choice — the menu simply starts empty.
 *
 *   5. RESERVATION FEE — none, or a fixed FCFA amount the customer pays online
 *      at booking. The customer is always told the fee is DEDUCTED from their
 *      final bill.
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
  const [feeType, setFeeType] = useState<FeeType>("none");
  const [feeValue, setFeeValue] = useState("");
  const [hasOwnDelivery, setHasOwnDelivery] = useState<boolean | null>(null);

  // Surfaced inline on the last step so a server-side failure shows up where
  // the user is looking, not as a toast that disappears. Cleared on re-edit.
  const [formError, setFormError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const stepCount = 5;

  const allSelected = selectedDishes.size === POPULAR_DISHES.length;

  /** Client-side check of the deposit amount — runs BEFORE any network call. */
  function feeValidationError(): string | null {
    if (feeType !== "fixed") return null;
    if (!feeValue.trim()) return t("stp.fee.valueRequired");
    const v = Number(feeValue);
    if (!Number.isInteger(v) || v < 0) return t("stp.fee.invalid");
    return null;
  }
  const feeError = feeValidationError();

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
    // Guard: one submission at a time. The button is disabled while busy, but
    // a transition can still be re-entered before the re-render lands, so the
    // ref is the real lock — it also stops a double-click double-charging the
    // reservation fee.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setFormError(null);

    startTransition(async () => {
      try {
        // The deposit amount is validated on the client BEFORE any network
        // call — it is already shown inline on the step, so if it is wrong we
        // stop here instead of making the user wait through delivery + hours
        // writes only to be told the number was invalid.
        if (feeError) return;

        const idle: ActionResult = { ok: true };
        const [delivery, hours, fee, seed] = await Promise.all([
          hasOwnDelivery !== null ? setDeliveryMode(hasOwnDelivery) : Promise.resolve(idle),
          setDefaultOpeningHours(),
          feeType === "fixed"
            ? setRestaurantDeposit(Number(feeValue), { type: "fixed" })
            : Promise.resolve(idle),
          seedPopularDishes([...selectedDishes]),
        ]);

        // Every step that failed, in one line at the bottom of the form —
        // never a toast that vanishes, and never a half-finished setup.
        const failures = [delivery, hours, fee, seed].filter(
          (r): r is { ok: false; error: string } => !r.ok,
        );
        if (failures.length > 0) {
          setFormError(failures.map((f) => f.error).join(" · "));
          return;
        }

        const result = await completeSetup();
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        toast(t("stp.done"), "success");
        router.push("/m");
      } finally {
        // Always release the lock and the spinner, even if an action threw
        // (a payload error or a redirect) — a stuck loading button with no
        // message is exactly the failure this finally is here to prevent.
        submittingRef.current = false;
        setBusy(false);
      }
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

      {/* ── Step 0: Tables ──────────────────────────────────────────────── */}
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

      {/* ── Step 1: Delivery capability ─────────────────────────────────── */}
      {step === 1 && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Bike className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{t("stp.delivery.title")}</h2>
              <p className="text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.delivery.body")}</p>

          <div className="mt-5 flex flex-col gap-2">
            {(
              [
                [true, t("stp.delivery.own"), t("stp.delivery.ownDesc")],
                [false, t("stp.delivery.platform"), t("stp.delivery.platformDesc")],
              ] as const
            ).map(([value, label, desc]) => (
              <label
                key={String(value)}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  hasOwnDelivery === value
                    ? "border-primary bg-primary-light/60"
                    : "border-border bg-surface-2/40 hover:border-primary/40",
                )}
              >
                <input
                  type="radio"
                  name="delivery-mode"
                  checked={hasOwnDelivery === value}
                  onChange={() => setHasOwnDelivery(value)}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <div>
                  <span className="text-sm font-semibold">{label}</span>
                  <p className="mt-0.5 text-xs text-text-secondary">{desc}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(0)}>
              {"←"}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setStep(2)}>
              {t("stp.delivery.continue")}
            </Button>
          </div>
        </section>
      )}

      {/* ── Step 2: Opening hours ───────────────────────────────────────── */}
      {step === 2 && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Clock className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{t("stp.hours.title")}</h2>
              <p className="text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.hours.body")}</p>

          <div className="mt-5 rounded-lg border border-border bg-surface-2/60 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <Clock className="size-4 text-primary" aria-hidden />
              <span>{t("stp.hours.default")}</span>
            </div>
            <p className="mt-1 text-sm text-text-secondary">{t("stp.hours.closed")}</p>
            <p className="mt-2 text-xs text-text-light">{t("stp.hours.note")}</p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(1)}>
              {"←"}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setStep(3)}>
              {t("stp.hours.continue")}
            </Button>
          </div>
        </section>
      )}

      {/* ── Step 3: Menu (categories + popular dishes on one screen) ───── */}
      {step === 3 && (
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

          <div className="my-5 border-t border-border" aria-hidden />

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
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
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
                    {/* The photo is what the picker is really selling — a
                        dish chosen from a grey square is a dish chosen blind. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={dish.image}
                      alt=""
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded-md object-cover"
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
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(2)}>
              {"←"}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setStep(4)}>
              {t("stp.categories.continue")}
            </Button>
          </div>
        </section>
      )}

      {/* ── Step 4: Reservation fee ─────────────────────────────────────── */}
      {step === 4 && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <BadgePercent className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{t("stp.fee.title")}</h2>
              <p className="text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.fee.body")}</p>

          <div className="mt-5 flex flex-col gap-2">
            {(
              [
                ["none", t("stp.fee.none")],
                ["fixed", t("stp.fee.fixed")],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                  feeType === value
                    ? "border-primary bg-primary-light/60"
                    : "border-border bg-surface-2/40 hover:border-primary/40",
                )}
              >
                <input
                  type="radio"
                  name="fee-type"
                  value={value}
                  checked={feeType === value}
                  onChange={() => setFeeType(value)}
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="text-sm font-semibold">{label}</span>
              </label>
            ))}
          </div>

          {feeType === "fixed" && (
            <Field
              label={t("stp.fee.fixedLabel")}
              htmlFor="fee-value"
              className="mt-4"
              error={feeError ?? undefined}
            >
              <Input
                id="fee-value"
                value={feeValue}
                onChange={(e) => {
                  setFeeValue(e.target.value);
                  // Re-editing clears a stale server-side error so we don't
                  // carry a message from a previous attempt into the next one.
                  if (formError) setFormError(null);
                }}
                placeholder="2 000"
                inputMode="numeric"
                invalid={Boolean(feeError)}
              />
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">{t("stp.fee.fixedHint")}</p>
            </Field>
          )}

          {/* Any server-side failure lands here, inside the form, not in a
              toast that disappears — so the user can read it while deciding
              what to do next. */}
          {formError && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-error bg-error/5 px-3 py-2 text-sm font-medium text-error"
            >
              {formError}
            </p>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(3)}>
              {"←"}
            </Button>
            <Button
              type="button"
              disabled={busy || Boolean(feeError)}
              loading={busy}
              onClick={finish}
            >
              {t("stp.fee.finish")}
            </Button>
          </div>
        </section>
      )}

      <p className="mt-8 text-center text-xs text-text-light">{userName}</p>
    </div>
  );
}
