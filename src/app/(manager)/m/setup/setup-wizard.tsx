"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, Bike, Check, ChefHat, Clock, Plus, Table2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  bulkCreateTables,
  completeSetup,
  seedPopularDishes,
  setRestaurantDeposit,
  setDeliveryFeeRange,
  setDeliveryOffering,
  setDefaultOpeningHours,
  upsertTable,
} from "@/lib/data/manager-actions";
import { POPULAR_DISHES } from "@/lib/data/dish-templates";
import { formatMoney } from "@/lib/format/currency";
import { useLocale } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/lib/data/manager";
import type { ActionResult } from "@/lib/data/admin-actions";

/** Seat counts offered by the bulk creator. Covers every real dining room. */
const SEAT_OPTIONS = [2, 4, 5, 6, 8, 10, 12];

/**
 * `none` and the two fees that are CHARGED ONLINE at booking.
 *
 * `percent` — a share of the final bill — is deliberately not offered here.
 * It cannot be taken at booking (the bill does not exist yet), so it is a
 * collect-on-arrival arrangement rather than a deposit, and putting it beside
 * two things that do take money now would teach the wrong model on the one
 * screen a restaurant sees before it opens. It stays available from
 * /m/reservations for a restaurant that wants it.
 */
type FeeType = "none" | "fixed" | "per_seat";

/**
 * The first-login setup wizard.
 *
 * Five steps, deliberately few choices:
 *
 *   1. TABLES — the bulk creator ("12 tables of 4") is the primary control,
 *      because a dining room is not entered one table at a time. The
 *      single-table form stays underneath for the odd numbered table.
 *      `canCreateTables` is false for waiters: they can skip and finish,
 *      their manager seeds the tables later.
 *
 *   2. DELIVERY — TWO questions, not one. First "do you deliver at all?",
 *      because plenty of restaurants do not and the wizard used to assume
 *      they all did. Only if yes: own riders or platform-managed, and the
 *      fee band the customer will be shown.
 *
 *   3. OPENING HOURS — pre-filled Mon–Sat 10h–22h, shown for awareness.
 *      The manager can adjust later from /m/profile.
 *
 *   4. MENU — the four default categories and the popular-dishes picker on
 *      one screen, so the card is set up in a single step. Each ticked dish
 *      is a COPY in the restaurant's own menu_items, AND ITS PRICE IS
 *      EDITABLE HERE: the templates carry a placeholder 2 500, and a
 *      restaurant that accepts eleven dishes at a price it does not charge
 *      is worse off than one with an empty menu.
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
  canSetFee,
}: {
  restaurantName: string;
  userName: string;
  tables: RestaurantTable[];
  categories: string[];
  canCreateTables: boolean;
  /**
   * `finance.manage`, which waiters and kitchen staff do not hold.
   *
   * Without this the fee step rendered for everyone and `setRestaurantDeposit`
   * answered a waiter's submit with a redirect to /not-found — the wizard
   * simply vanished mid-setup, with no message and no way back to where they
   * were. Roles that cannot set it are told so and finish without it.
   */
  canSetFee: boolean;
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
  const [bulkCount, setBulkCount] = useState("4");
  const [bulkSeats, setBulkSeats] = useState("4");

  /**
   * Chosen dishes AND the price each will be listed at, keyed by dish id.
   *
   * A Map rather than a Set: ticking a dish and pricing it are the same
   * decision, and splitting them across two pieces of state is how the two
   * drift apart when a dish is unticked and re-ticked.
   */
  const [selectedDishes, setSelectedDishes] = useState<Map<string, string>>(new Map());

  const [feeType, setFeeType] = useState<FeeType>("none");
  const [feeValue, setFeeValue] = useState("");

  const [offersDelivery, setOffersDelivery] = useState<boolean | null>(null);
  const [hasOwnDelivery, setHasOwnDelivery] = useState<boolean | null>(null);
  const [minFee, setMinFee] = useState("");
  const [maxFee, setMaxFee] = useState("");

  // Surfaced inline on the last step so a server-side failure shows up where
  // the user is looking, not as a toast that disappears. Cleared on re-edit.
  const [formError, setFormError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const stepCount = 5;

  const allSelected = selectedDishes.size === POPULAR_DISHES.length;

  /** Client-side check of the deposit amount — runs BEFORE any network call. */
  function feeValidationError(): string | null {
    if (!canSetFee) return null;
    if (feeType === "none") return null;
    if (!feeValue.trim()) return t("stp.fee.valueRequired");
    const v = Number(feeValue);
    if (!Number.isInteger(v) || v < 0) return t("stp.fee.invalid");
    return null;
  }
  const feeError = feeValidationError();

  /**
   * The delivery band, checked before it is sent.
   *
   * Both fields are optional — a restaurant that does not want to commit to
   * a range leaves them blank — but a max BELOW a min is incoherent, and the
   * database rejects it with a constraint name rather than a sentence.
   */
  function rangeValidationError(): string | null {
    if (!offersDelivery || !hasOwnDelivery) return null;
    const min = minFee.trim() === "" ? 0 : Number(minFee);
    const max = maxFee.trim() === "" ? 0 : Number(maxFee);
    if (!Number.isInteger(min) || min < 0) return t("stp.delivery.feeInvalid");
    if (!Number.isInteger(max) || max < 0) return t("stp.delivery.feeInvalid");
    if (max !== 0 && max < min) return t("stp.delivery.feeOrder");
    return null;
  }
  const rangeError = rangeValidationError();

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

  /**
   * "I have N tables of M seats" — one action, one round trip.
   *
   * The optimistic rows are rebuilt from the same skip-what-is-taken rule the
   * server uses, so the list the owner sees matches the floor that was
   * actually created rather than a numbering that only agrees by luck.
   */
  function submitBulk(e: React.FormEvent) {
    e.preventDefault();
    const count = Number(bulkCount);
    const seats = Number(bulkSeats);
    if (!Number.isInteger(count) || count < 1) return toast(t("stp.tables.bulkCountInvalid"), "error");
    if (!Number.isInteger(seats) || seats < 1) return toast(t("stp.seatsInvalid"), "error");

    startTransition(async () => {
      setBusy(true);
      const result = await bulkCreateTables({ count, capacity: seats });
      setBusy(false);
      if (!result.ok) return toast(result.error, "error");

      setTables((prev) => {
        const taken = new Set(prev.map((tbl) => String(tbl.number).trim()));
        const created: RestaurantTable[] = [];
        for (let n = 1; created.length < count && n <= count + taken.size + 1; n++) {
          if (taken.has(String(n))) continue;
          created.push({
            id: crypto.randomUUID(),
            number: String(n),
            capacity: seats,
            status: "available",
            activePartySize: null,
          });
        }
        return [...prev, ...created];
      });

      router.refresh();
      toast(t("stp.tables.bulkAdded", { count, seats }), "success");
    });
  }

  function submitCustom(e: React.FormEvent) {
    e.preventDefault();
    const seats = Number(capacity);
    if (!number.trim()) return toast(t("stp.tableRequired"), "error");
    if (!Number.isInteger(seats) || seats < 1) return toast(t("stp.seatsInvalid"), "error");
    addTable(number.trim(), seats);
    setNumber("");
  }

  function toggleDish(id: string, templatePrice: number) {
    setSelectedDishes((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, String(templatePrice));
      return next;
    });
  }

  function setDishPrice(id: string, price: string) {
    setSelectedDishes((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.set(id, price);
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
        const [delivery, range, hours, fee, seed] = await Promise.all([
          offersDelivery !== null
            ? setDeliveryOffering({
                offersDelivery,
                hasOwnDelivery: hasOwnDelivery ?? undefined,
              })
            : Promise.resolve(idle),
          // Only when they carry their own riders: a platform-delivered
          // restaurant does not set this number, the admin does.
          offersDelivery && hasOwnDelivery && !rangeError && (minFee.trim() || maxFee.trim())
            ? setDeliveryFeeRange({
                min: minFee.trim() === "" ? 0 : Number(minFee),
                max: maxFee.trim() === "" ? 0 : Number(maxFee),
              })
            : Promise.resolve(idle),
          setDefaultOpeningHours(),
          canSetFee && feeType !== "none"
            ? setRestaurantDeposit(Number(feeValue), { type: feeType })
            : Promise.resolve(idle),
          seedPopularDishes(
            [...selectedDishes].map(([id, price]) => ({
              id,
              // Blank or nonsense falls back to the template price on the
              // server; sending NaN would be indistinguishable from "unset".
              price: Number.isInteger(Number(price)) ? Number(price) : undefined,
            })),
          ),
        ]);

        // Every step that failed, in one line at the bottom of the form —
        // never a toast that vanishes, and never a half-finished setup.
        const failures = [delivery, range, hours, fee, seed].filter(
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
        /*
          `?welcome=1` is what tells the dashboard this arrival is the end of
          onboarding rather than an ordinary visit — it is what triggers the
          scroll down to the "finish your setup" panel. A flag in the URL
          rather than component state because this is a full navigation: any
          state held here is gone by the time /m renders.
        */
        router.push("/m?welcome=1");
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
    // `px-3` below `sm`: the card inside already carries its own padding, and
    // two nested 24px gutters on a 360px screen leave the forms too narrow to
    // use.
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-3 py-6 sm:px-4 sm:py-8">
      <div className="mb-6 text-center sm:mb-8">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-light text-primary">
          <ChefHat className="size-7" aria-hidden />
        </div>
        <h1 className="font-display text-xl font-bold sm:text-3xl">{t("stp.title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t("stp.subtitle")}</p>
        <p className="mt-4 text-xs font-semibold tracking-wide text-text-light uppercase">
          {t("stp.step", { step: step + 1, total: stepCount })}
        </p>
      </div>

      {/* Progress dots */}
      <div className="mb-6 flex justify-center gap-2 sm:mb-8" aria-hidden>
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
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Table2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">{t("stp.tables.title")}</h2>
              <p className="truncate text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.tables.body")}</p>

          {canCreateTables ? (
            <>
              {/*
                THE BULK CREATOR IS THE PRIMARY CONTROL.

                "I have 12 tables of 4" is one sentence and is now one action.
                The count is a text box because it is a number nobody has a
                default for; the seats are a SELECT because the realistic
                answers are a short list and typing "4" into a second free
                field on a phone keyboard is friction for no gain.
              */}
              <form
                onSubmit={submitBulk}
                className="mt-5 rounded-lg border border-dashed border-border bg-surface-2/60 p-4"
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-primary" aria-hidden />
                  {t("stp.tables.bulkTitle")}
                </h3>
                <p className="mt-1 text-sm text-text-secondary">{t("stp.tables.bulkBody")}</p>

                {/* Two columns from the very smallest width: a number field
                    and a short select both stay usable at ~150px, and stacking
                    them pushes the button below the fold. */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label={t("stp.tables.bulkCount")} htmlFor="bulk-count" className="min-w-0">
                    <Input
                      id="bulk-count"
                      value={bulkCount}
                      onChange={(e) => setBulkCount(e.target.value)}
                      placeholder="4"
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label={t("stp.tables.bulkSeats")} htmlFor="bulk-seats" className="min-w-0">
                    <Select
                      id="bulk-seats"
                      value={bulkSeats}
                      onChange={(e) => setBulkSeats(e.target.value)}
                    >
                      {SEAT_OPTIONS.map((seats) => (
                        <option key={seats} value={seats}>
                          {t("mt.seatsShort", { count: seats })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Button type="submit" fullWidth className="mt-3" disabled={busy}>
                  <Plus className="size-4" aria-hidden />
                  {t("stp.tables.bulkAdd", {
                    count: Number(bulkCount) || 0,
                    seats: Number(bulkSeats) || 0,
                  })}
                </Button>
              </form>

              <details className="mt-4 rounded-lg border border-border bg-surface-2/40 p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  {t("stp.tables.oneTitle")}
                </summary>
                <form onSubmit={submitCustom} className="mt-3 grid grid-cols-2 gap-3">
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
                  <Button
                    type="submit"
                    variant="outline"
                    fullWidth
                    disabled={busy}
                    className="col-span-2"
                  >
                    <Plus className="size-4" aria-hidden />
                    {t("stp.tables.add")}
                  </Button>
                </form>
              </details>
            </>
          ) : (
            <p className="mt-4 rounded-lg bg-surface-2/60 p-3 text-sm text-text-secondary">
              {t("stp.tables.noRights")}
            </p>
          )}

          {tables.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold tracking-wide text-text-light uppercase">
                {t("stp.tables.list")} ({tables.length})
              </h3>
              {/* Capped and scrolling: fifty tables is a legitimate answer and
                  must not bury the Continue button under fifty rows. */}
              <ul className="mt-2 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {tables.map((table) => (
                  <li
                    key={table.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm"
                  >
                    <span className="truncate font-medium">{table.number}</span>
                    <span className="shrink-0 text-text-light">
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

      {/* ── Step 1: Delivery ────────────────────────────────────────────── */}
      {step === 1 && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Bike className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">{t("stp.delivery.title")}</h2>
              <p className="truncate text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          {/*
            QUESTION ONE: DO YOU DELIVER AT ALL?

            This used to be assumed. A restaurant with no rider had to pick one
            of two delivery arrangements it could not honour, and then appeared
            in the directory promising delivery. Answering "no" here sets
            accepts_delivery = false, and the dashboard toggle turns it back on
            the day they hire someone.
          */}
          <p className="text-sm text-text-secondary">{t("stp.delivery.askBody")}</p>

          <div className="mt-4 flex flex-col gap-2">
            {(
              [
                [true, t("stp.delivery.yes"), t("stp.delivery.yesDesc")],
                [false, t("stp.delivery.no"), t("stp.delivery.noDesc")],
              ] as const
            ).map(([value, label, desc]) => (
              <label
                key={String(value)}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  offersDelivery === value
                    ? "border-primary bg-primary-light/60"
                    : "border-border bg-surface-2/40 hover:border-primary/40",
                )}
              >
                <input
                  type="radio"
                  name="offers-delivery"
                  checked={offersDelivery === value}
                  onChange={() => setOffersDelivery(value)}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <div className="min-w-0">
                  <span className="text-sm font-semibold">{label}</span>
                  <p className="mt-0.5 text-xs text-text-secondary">{desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* QUESTION TWO, and only if the first was yes. */}
          {offersDelivery === true && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="text-sm text-text-secondary">{t("stp.delivery.body")}</p>

              <div className="mt-4 flex flex-col gap-2">
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
                    <div className="min-w-0">
                      <span className="text-sm font-semibold">{label}</span>
                      <p className="mt-0.5 text-xs text-text-secondary">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/*
            THE BAND THE CUSTOMER IS SHOWN.

            Only for restaurants carrying their own riders — a platform-
            delivered one does not set this number, the admin does. Both
            fields are optional, but filling them is what turns "delivery fee:
            to be confirmed" into "delivery 1 000 – 3 000 FCFA" on the page a
            customer decides from.
          */}
          {offersDelivery === true && hasOwnDelivery === true && (
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">{t("stp.delivery.feeTitle")}</h3>
              <p className="mt-1 text-sm text-text-secondary">{t("stp.delivery.feeBody")}</p>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label={t("stp.delivery.feeMin")} htmlFor="fee-min" className="min-w-0">
                  <Input
                    id="fee-min"
                    value={minFee}
                    onChange={(e) => setMinFee(e.target.value)}
                    placeholder="1 000"
                    inputMode="numeric"
                    suffix="FCFA"
                  />
                </Field>
                <Field label={t("stp.delivery.feeMax")} htmlFor="fee-max" className="min-w-0">
                  <Input
                    id="fee-max"
                    value={maxFee}
                    onChange={(e) => setMaxFee(e.target.value)}
                    placeholder="3 000"
                    inputMode="numeric"
                    suffix="FCFA"
                    invalid={Boolean(rangeError)}
                  />
                </Field>
              </div>
              {rangeError ? (
                <p role="alert" className="mt-2 text-xs font-medium text-error">
                  {rangeError}
                </p>
              ) : (
                <p className="mt-2 text-xs text-text-light">{t("stp.delivery.feeHint")}</p>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep(0)}>
              {"←"}
            </Button>
            <Button
              type="button"
              disabled={busy || Boolean(rangeError)}
              onClick={() => setStep(2)}
            >
              {t("stp.delivery.continue")}
            </Button>
          </div>
        </section>
      )}

      {/* ── Step 2: Opening hours ───────────────────────────────────────── */}
      {step === 2 && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Clock className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">{t("stp.hours.title")}</h2>
              <p className="truncate text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">{t("stp.hours.body")}</p>

          <div className="mt-5 rounded-lg border border-border bg-surface-2/60 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <Clock className="size-4 shrink-0 text-primary" aria-hidden />
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
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <Check className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">{t("stp.categories.title")}</h2>
              <p className="truncate text-sm text-text-secondary">{restaurantName}</p>
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
                setSelectedDishes(
                  allSelected
                    ? new Map()
                    : new Map(POPULAR_DISHES.map((d) => [d.id, String(d.price)])),
                )
              }
            >
              {allSelected ? t("stp.dishes.clear") : t("stp.dishes.selectAll")}
            </Button>
            <span className="tnum ml-auto text-sm font-semibold text-primary">
              {selectedDishes.size}/{POPULAR_DISHES.length}
            </span>
          </div>

          {/*
            ONE COLUMN ON A PHONE, TWO FROM `sm`.

            The row is photo + name + description + a price field. At two
            columns on a 360px screen each cell is ~160px wide, which leaves
            the price box about 60px — too narrow to read "2 500" in, let alone
            edit. It was a two-column grid at every width before, which is what
            made this step feel broken on mobile.
          */}
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {POPULAR_DISHES.map((dish) => {
              const checked = selectedDishes.has(dish.id);
              const price = selectedDishes.get(dish.id) ?? String(dish.price);

              return (
                <li key={dish.id}>
                  <div
                    className={cn(
                      "rounded-lg border transition-colors",
                      checked
                        ? "border-primary bg-primary-light/60"
                        : "border-border bg-surface-2/40 hover:border-primary/40",
                    )}
                  >
                    <label className="flex cursor-pointer items-center gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDish(dish.id, dish.price)}
                        className="size-4 shrink-0 accent-[var(--primary)]"
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
                        <span className="block text-sm font-semibold">{dish.name}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-text-secondary">
                          {dish.description}
                        </span>
                        {!checked && (
                          <span className="tnum mt-1 block text-xs font-bold text-primary">
                            {formatMoney(dish.price)}
                          </span>
                        )}
                      </span>
                    </label>

                    {/*
                      THE PRICE IS EDITABLE, AND ONLY ONCE THE DISH IS TICKED.

                      Every template ships at the same placeholder 2 500. A
                      restaurant that accepts the starter menu and never
                      notices is now advertising eleven dishes at a price it
                      does not charge — and the first customer to arrive with
                      that expectation is a genuine argument at the till.
                      Showing the field only for chosen dishes keeps the
                      picker scannable while it is still being scanned.
                    */}
                    {checked && (
                      <div className="flex items-center gap-2 border-t border-primary/25 px-3 py-2.5">
                        <label
                          htmlFor={`price-${dish.id}`}
                          className="shrink-0 text-xs font-semibold text-text-secondary"
                        >
                          {t("stp.dishes.price")}
                        </label>
                        <Input
                          id={`price-${dish.id}`}
                          value={price}
                          onChange={(e) => setDishPrice(dish.id, e.target.value)}
                          inputMode="numeric"
                          suffix="FCFA"
                          className="h-9"
                          invalid={!Number.isInteger(Number(price)) || Number(price) < 0}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-xs text-text-light">{t("stp.dishes.imageNote")}</p>

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
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
              <BadgePercent className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">{t("stp.fee.title")}</h2>
              <p className="truncate text-sm text-text-secondary">{restaurantName}</p>
            </div>
          </div>

          {!canSetFee ? (
            <p className="rounded-lg bg-surface-2/60 p-3 text-sm text-text-secondary">
              {t("stp.fee.noRights")}
            </p>
          ) : (
            <>
              <p className="text-sm text-text-secondary">{t("stp.fee.body")}</p>

              {/*
                Each option carries its own one-line explanation, because the
                difference between the two fees is the whole decision and it is
                not visible from their names. A restaurant picking blind tends
                to pick the flat fee, which is the one that prices a table of
                ten the same as a two-top.

                `items-start` and `min-w-0`: the descriptions wrap on a phone,
                and a radio vertically centred against two lines of text reads
                as belonging to neither.
              */}
              <div className="mt-5 flex flex-col gap-2">
                {(
                  [
                    ["none", t("stp.fee.none"), t("stp.fee.noneBody")],
                    ["fixed", t("stp.fee.fixed"), t("stp.fee.fixedBody")],
                    ["per_seat", t("stp.fee.perSeat"), t("stp.fee.perSeatBody")],
                  ] as const
                ).map(([value, label, body]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
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
                      className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary">
                        {body}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {feeType !== "none" && (
                <Field
                  label={feeType === "per_seat" ? t("stp.fee.perSeatLabel") : t("stp.fee.fixedLabel")}
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
                    placeholder={feeType === "per_seat" ? "1 500" : "2 000"}
                    inputMode="numeric"
                    suffix={feeType === "per_seat" ? t("stp.fee.perSeatSuffix") : "FCFA"}
                    invalid={Boolean(feeError)}
                  />
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                    {feeType === "per_seat" ? t("stp.fee.perSeatHint") : t("stp.fee.fixedHint")}
                  </p>

                  {/* The worked example, at the sizes a dining room actually
                      books. A per-guest rate is an abstraction until you see
                      what a table of five pays. */}
                  {feeType === "per_seat" && Number.isInteger(Number(feeValue)) && Number(feeValue) > 0 && (
                    <p className="tnum mt-2 rounded-md bg-surface-2/60 p-2.5 text-xs leading-relaxed text-text-secondary">
                      {t("stp.fee.perSeatExample", {
                        two: formatMoney(Number(feeValue) * 2),
                        five: formatMoney(Number(feeValue) * 5),
                      })}
                    </p>
                  )}
                </Field>
              )}
            </>
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
