"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ExternalLink, MapPin, Phone, Save, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { CardBody, Panel } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ImageUpload } from "@/components/ui/image-upload";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { parseMoney } from "@/lib/format/currency";
import { updateRestaurantProfile } from "@/lib/data/manager-actions";
import { saveOpeningHours, uploadRestaurantImage } from "@/lib/data/profile-actions";
import type { LookupOption, RestaurantProfile } from "@/lib/data/profile";
import { intlLocale, useLocale } from "@/lib/i18n/use-locale";

/**
 * One fixed week, built ONCE at module load and never during render.
 *
 * 7 January 2024 was a Sunday, so index 0…6 lines up with the `weekday` column
 * (0 = Sunday). A literal date reads no clock, which is what keeps the render
 * pure — an argument-less `new Date()` here would fail the compiler's purity
 * lint and make the output depend on when the page happened to render.
 */
const WEEK = Array.from({ length: 7 }, (_, weekday) => new Date(Date.UTC(2024, 0, 7 + weekday)));

/** A file chosen but not yet sent, or the current image marked for removal. */
type ImageChoice = { file: File; previewUrl: string } | { remove: true };

interface Draft {
  name: string;
  branchLabel: string;
  description: string;
  phone: string;
  addressLine: string;
  cuisineId: string;
  quartierId: string;
  /** Kept as typed text so the field can be emptied mid-edit; parsed on Save. */
  minimumOrder: string;
  deliveryEstimateMin: string;
  minDeliveryFee: string;
  maxDeliveryFee: string;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
}

interface HourDraft {
  weekday: number;
  open: boolean;
  /** "HH:MM", empty when the day is closed or was never filled in. */
  opensAt: string;
  closesAt: string;
}

/** Shown when the branch row cannot be read — never a blank page. */
export function ProfileMissing() {
  const { t } = useLocale();

  return (
    <div className="rounded-lg border border-border bg-surface">
      <EmptyState icon={<Store />} title={t("mpf.missing")} description={t("mpf.missingBody")} />
    </div>
  );
}

export function ProfileForm({
  profile,
  cuisines,
  quartiers,
}: {
  profile: RestaurantProfile;
  cuisines: LookupOption[];
  quartiers: LookupOption[];
}) {
  const { locale, t } = useLocale();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  /**
   * The saved values, recomputed from the props on every render.
   *
   * `draft` below seeds from this exactly once — useState ignores every later
   * value of its argument — so the "has this changed" comparison has to read
   * the PROP, not a second copy of it. The page mounts this component with
   * `key={profile.id}`, which is what makes switching branch start a new draft.
   */
  const saved: Draft = {
    name: profile.name,
    branchLabel: profile.branchLabel,
    description: profile.description,
    phone: profile.phone,
    addressLine: profile.addressLine,
    cuisineId: profile.cuisineId ?? "",
    quartierId: profile.quartierId ?? "",
    minimumOrder: String(profile.minimumOrder),
    deliveryEstimateMin: String(profile.deliveryEstimateMin),
    // Blank rather than "0" when nothing is declared: an empty box reads as
    // "not set", where a zero reads as a promise to deliver for free.
    minDeliveryFee: profile.minDeliveryFee > 0 ? String(profile.minDeliveryFee) : "",
    maxDeliveryFee: profile.maxDeliveryFee > 0 ? String(profile.maxDeliveryFee) : "",
    acceptsDelivery: profile.acceptsDelivery,
    acceptsPickup: profile.acceptsPickup,
  };

  const [draft, setDraft] = useState<Draft>(saved);
  const [hours, setHours] = useState<HourDraft[]>(() => seedHours(profile));
  const [logo, setLogo] = useState<ImageChoice | null>(null);
  const [cover, setCover] = useState<ImageChoice | null>(null);

  /**
   * Weekday names in the interface language.
   *
   * Not a hardcoded French array: a third language would then need seven more
   * strings, and Intl already knows them everywhere. Formatted in UTC because
   * the reference dates are UTC midnights — a timezone west of Greenwich would
   * otherwise shift every name back by a day.
   */
  const weekdayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", timeZone: "UTC" });
    return WEEK.map((date) => {
      const name = format.format(date);
      return name.charAt(0).toUpperCase() + name.slice(1);
    });
  }, [locale]);

  function patch(changes: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function patchHour(weekday: number, changes: Partial<HourDraft>) {
    setHours((current) => current.map((h) => (h.weekday === weekday ? { ...h, ...changes } : h)));
  }

  /* ── Images ──────────────────────────────────────────────────────────── */

  /** A blob: URL is a live handle — dropping the state without freeing it leaks. */
  function release(choice: ImageChoice | null) {
    if (choice && "previewUrl" in choice) URL.revokeObjectURL(choice.previewUrl);
  }

  /**
   * Choosing is not saving.
   *
   * The file waits here behind a local preview and is sent by Save, exactly
   * like every other field. A picker that uploaded on selection would be the
   * one control on the page that walking away could not undo.
   */
  function imageSlot(choice: ImageChoice | null, set: (next: ImageChoice | null) => void) {
    return {
      onSelect(file: File) {
        // Both the createObjectURL and the revoke happen HERE, not inside the
        // updater: React may call an updater twice, and a side effect in one
        // leaks a URL or frees a live one.
        const previewUrl = URL.createObjectURL(file);
        release(choice);
        set({ file, previewUrl });
      },
      onUndo() {
        release(choice);
        set(null);
      },
      onRemove() {
        release(choice);
        // Marked, not applied. Save is still the thing that commits it.
        set({ remove: true });
      },
    };
  }

  const logoSlot = imageSlot(logo, setLogo);
  const coverSlot = imageSlot(cover, setCover);

  /** The pending blob if there is one, the marked-removal blank, else what is saved. */
  function previewOf(choice: ImageChoice | null, savedUrl: string | null): string | null {
    if (!choice) return savedUrl;
    return "previewUrl" in choice ? choice.previewUrl : null;
  }

  /** Persists the bytes and hands back the URL to store; null clears the column. */
  async function resolveImage(
    choice: ImageChoice | null,
    savedUrl: string | null,
  ): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
    if (!choice) return { ok: true, url: savedUrl };
    if ("remove" in choice) return { ok: true, url: null };

    const body = new FormData();
    body.append("file", choice.file);

    const upload = await uploadRestaurantImage(body);
    if (!upload.ok) return { ok: false, error: upload.error ?? t("mpf.uploadFailed") };

    return { ok: true, url: upload.url ?? null };
  }

  /* ── What is unsaved ─────────────────────────────────────────────────── */

  const changedFields = (Object.keys(saved) as (keyof Draft)[]).filter(
    (key) => draft[key] !== saved[key],
  );

  /**
   * A day that was never recorded reads as closed and does NOT count as a change.
   *
   * Counting it would leave the page permanently dirty on arrival for every
   * restaurant with an incomplete week. The "never set" badge says the same
   * thing honestly, and the first Save writes all seven days explicitly.
   */
  const hoursDirty = hours.some((day) => {
    const before = profile.hours[day.weekday];
    const wasOpen = before.opensAt !== null;
    if (day.open !== wasOpen) return true;
    if (!day.open) return false;
    return day.opensAt !== (before.opensAt ?? "") || day.closesAt !== (before.closesAt ?? "");
  });

  const dirtyCount = changedFields.length + (hoursDirty ? 1 : 0) + (logo ? 1 : 0) + (cover ? 1 : 0);

  /** Days switched on with only one of the two times — flagged before Save runs. */
  const incompleteDays = new Set(
    hours.filter((day) => day.open && (!day.opensAt || !day.closesAt)).map((day) => day.weekday),
  );

  function discard() {
    setDraft(saved);
    setHours(seedHours(profile));
    release(logo);
    release(cover);
    setLogo(null);
    setCover(null);
  }

  /* ── Save ────────────────────────────────────────────────────────────── */

  /**
   * Commit the whole page, images first.
   *
   * Images first because they are the failure-prone half — an upload is refused
   * by its CONTENTS, not by its name — and stopping there leaves everything the
   * manager typed on screen rather than saving a profile that claims a logo it
   * never received.
   *
   * The hours go last and go every time: `saveOpeningHours` writes all seven
   * days as a set, so a day that was never recorded stops being ambiguous from
   * the first save onwards.
   */
  function save() {
    const name = draft.name.trim();
    if (name.length < 2) return toast(t("mpf.invalidName"), "error");

    const minimumOrder = parseMoney(draft.minimumOrder);
    if (minimumOrder === null || minimumOrder < 0) return toast(t("mpf.invalidMinimum"), "error");

    // Empty is legitimate — it means "no band declared" — so blank maps to 0
    // rather than to NaN, which would fail validation for saying nothing.
    const minFee = draft.minDeliveryFee.trim() === "" ? 0 : parseMoney(draft.minDeliveryFee);
    const maxFee = draft.maxDeliveryFee.trim() === "" ? 0 : parseMoney(draft.maxDeliveryFee);
    if (minFee === null || minFee < 0) return toast(t("mpf.invalidFee"), "error");
    if (maxFee === null || maxFee < 0) return toast(t("mpf.invalidFee"), "error");
    if (maxFee !== 0 && maxFee < minFee) return toast(t("mpf.invalidFeeOrder"), "error");

    const estimate = Number.parseInt(draft.deliveryEstimateMin, 10);
    if (!Number.isInteger(estimate) || estimate < 1) return toast(t("mpf.invalidEstimate"), "error");

    const incomplete = hours.find((day) => incompleteDays.has(day.weekday));
    if (incomplete) {
      return toast(t("mpf.hours.incomplete", { day: weekdayNames[incomplete.weekday] }), "error");
    }

    startTransition(async () => {
      const logoResult = await resolveImage(logo, profile.logoUrl);
      if (!logoResult.ok) return toast(logoResult.error, "error");

      const coverResult = await resolveImage(cover, profile.coverUrl);
      if (!coverResult.ok) return toast(coverResult.error, "error");

      const result = await updateRestaurantProfile({
        name,
        branchLabel: draft.branchLabel,
        description: draft.description,
        phone: draft.phone,
        addressLine: draft.addressLine,
        cuisineId: draft.cuisineId || null,
        quartierId: draft.quartierId || null,
        logoUrl: logoResult.url,
        coverUrl: coverResult.url,
        deliveryEstimateMin: estimate,
        minimumOrder,
        minDeliveryFee: minFee,
        maxDeliveryFee: maxFee,
        acceptsDelivery: draft.acceptsDelivery,
        acceptsPickup: draft.acceptsPickup,
      });
      if (!result.ok) return toast(result.error, "error");

      const written = await saveOpeningHours(
        hours.map((day) => ({
          weekday: day.weekday,
          opensAt: day.open ? day.opensAt : null,
          closesAt: day.open ? day.closesAt : null,
        })),
      );
      if (!written.ok) return toast(written.error, "error");

      // Re-seeded from what the server actually stored: the action trims and
      // the two numbers are normalised, so without this the form would keep
      // calling itself dirty against values it had just saved.
      setDraft((current) => ({
        ...current,
        name,
        description: current.description.trim(),
        phone: current.phone.trim(),
        addressLine: current.addressLine.trim(),
        minimumOrder: String(minimumOrder),
        deliveryEstimateMin: String(estimate),
        minDeliveryFee: minFee > 0 ? String(minFee) : "",
        maxDeliveryFee: maxFee > 0 ? String(maxFee) : "",
      }));

      release(logo);
      release(cover);
      setLogo(null);
      setCover(null);

      toast(t("mpf.saved"), "success");
    });
  }

  // A cuisine or quartier that has since been deactivated is still this
  // restaurant's answer. Dropping it from the list would quietly re-file the
  // restaurant under "not set" the next time anybody pressed Save.
  const cuisineOptions = withCurrent(cuisines, profile.cuisineId, profile.cuisineName);
  const quartierOptions = withCurrent(quartiers, profile.quartierId, profile.quartierName);

  const noChannel = !draft.acceptsDelivery && !draft.acceptsPickup;

  return (
    <div className="flex flex-col">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* ── Details ───────────────────────────────────────────────── */}
          <Panel title={t("mpf.info")}>
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Field label={t("mpf.name")} htmlFor="rp-name" required>
                <Input
                  id="rp-name"
                  icon={<Store />}
                  value={draft.name}
                  disabled={pending}
                  placeholder={t("mpf.namePlaceholder")}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>

              <Field label={t("mpf.branch")} htmlFor="rp-branch" hint={t("mpf.branchHint")}>
                <Input
                  id="rp-branch"
                  value={draft.branchLabel}
                  disabled={pending}
                  onChange={(e) => patch({ branchLabel: e.target.value })}
                />
              </Field>

              <Field label={t("mpf.cuisine")} htmlFor="rp-cuisine" hint={t("mpf.cuisineHint")}>
                <Select
                  id="rp-cuisine"
                  value={draft.cuisineId}
                  disabled={pending}
                  onChange={(e) => patch({ cuisineId: e.target.value })}
                >
                  <option value="">{t("mpf.cuisineNone")}</option>
                  {cuisineOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t("mpf.phone")} htmlFor="rp-phone" hint={t("mpf.phoneHint")}>
                <Input
                  id="rp-phone"
                  type="tel"
                  icon={<Phone />}
                  value={draft.phone}
                  disabled={pending}
                  placeholder={t("mpf.phonePlaceholder")}
                  autoComplete="tel"
                  onChange={(e) => patch({ phone: e.target.value })}
                />
              </Field>

              <Field
                label={t("mpf.description")}
                htmlFor="rp-description"
                className="sm:col-span-2"
                hint={t("mpf.descriptionHint")}
              >
                <Textarea
                  id="rp-description"
                  rows={4}
                  value={draft.description}
                  disabled={pending}
                  placeholder={t("mpf.descriptionPlaceholder")}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </Field>

              <Field label={t("mpf.quartier")} htmlFor="rp-quartier" hint={t("mpf.quartierHint")}>
                <Select
                  id="rp-quartier"
                  value={draft.quartierId}
                  disabled={pending}
                  onChange={(e) => patch({ quartierId: e.target.value })}
                >
                  <option value="">{t("mpf.quartierNone")}</option>
                  {quartierOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t("mpf.address")} htmlFor="rp-address">
                <Input
                  id="rp-address"
                  icon={<MapPin />}
                  value={draft.addressLine}
                  disabled={pending}
                  placeholder={t("mpf.addressPlaceholder")}
                  onChange={(e) => patch({ addressLine: e.target.value })}
                />
              </Field>

              {/* The slug is deliberately not editable — changing it would break
                  every link this restaurant has ever shared, and there is no
                  redirect table. */}
              <Field
                label={t("mpf.publicUrl")}
                htmlFor="rp-slug"
                className="sm:col-span-2"
                hint={t("mpf.publicUrlHint")}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="rp-slug"
                    value={`/restaurants/${profile.slug}`}
                    disabled
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Link
                    href={`/restaurants/${profile.slug}`}
                    target="_blank"
                    className={buttonClasses({
                      variant: "outline",
                      size: "sm",
                      className: "w-full sm:w-auto",
                    })}
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    <span>{t("mpf.viewPublic")}</span>
                  </Link>
                </div>
              </Field>
            </CardBody>
          </Panel>

          {/* ── Opening hours ─────────────────────────────────────────── */}
          <Panel title={t("mpf.hours")} description={t("mpf.hoursDesc")}>
            <ul className="divide-y divide-border">
              {hours.map((day) => {
                const dayName = weekdayNames[day.weekday];
                const overnight =
                  day.open && day.opensAt !== "" && day.closesAt !== "" && day.closesAt <= day.opensAt;

                return (
                  <li
                    key={day.weekday}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-2 sm:w-56">
                      <Switch
                        label={dayName}
                        aria-label={t("mpf.hours.openOn", { day: dayName })}
                        checked={day.open}
                        disabled={pending}
                        onChange={(e) => patchHour(day.weekday, { open: e.target.checked })}
                      />
                      {!profile.hours[day.weekday].isRecorded && (
                        <Badge tone="neutral">{t("mpf.hours.unset")}</Badge>
                      )}
                    </div>

                    {day.open ? (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`opens-${day.weekday}`}>
                          {t("mpf.hours.opensAt", { day: dayName })}
                        </label>
                        <Input
                          id={`opens-${day.weekday}`}
                          type="time"
                          value={day.opensAt}
                          disabled={pending}
                          invalid={day.opensAt === "" && incompleteDays.has(day.weekday)}
                          className="h-10 w-32"
                          onChange={(e) => patchHour(day.weekday, { opensAt: e.target.value })}
                        />
                        <span className="text-sm text-text-light">{t("mpf.hours.to")}</span>
                        <label className="sr-only" htmlFor={`closes-${day.weekday}`}>
                          {t("mpf.hours.closesAt", { day: dayName })}
                        </label>
                        <Input
                          id={`closes-${day.weekday}`}
                          type="time"
                          value={day.closesAt}
                          disabled={pending}
                          invalid={day.closesAt === "" && incompleteDays.has(day.weekday)}
                          className="h-10 w-32"
                          onChange={(e) => patchHour(day.weekday, { closesAt: e.target.value })}
                        />
                        {/* A grill open 18:00–02:00 is the most ordinary evening
                            in the city, so this is a note, never a rejection. */}
                        {overnight && (
                          <span className="text-xs text-text-light">{t("mpf.hours.overnight")}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-text-light">{t("mpf.hours.closed")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          {/* ── Delivery ──────────────────────────────────────────────── */}
          <Panel title={t("mpf.delivery")} description={t("mpf.deliveryDesc")}>
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Field
                label={t("mpf.minimumOrder")}
                htmlFor="rp-minimum"
                hint={t("mpf.minimumOrderHint")}
              >
                <Input
                  id="rp-minimum"
                  inputMode="numeric"
                  suffix="FCFA"
                  value={draft.minimumOrder}
                  disabled={pending}
                  onChange={(e) => patch({ minimumOrder: e.target.value })}
                />
              </Field>

              <Field label={t("mpf.estimate")} htmlFor="rp-estimate" hint={t("mpf.estimateHint")}>
                <Input
                  id="rp-estimate"
                  type="number"
                  min={1}
                  step={1}
                  suffix={t("mpf.minutes")}
                  value={draft.deliveryEstimateMin}
                  disabled={pending}
                  onChange={(e) => patch({ deliveryEstimateMin: e.target.value })}
                />
              </Field>

              {/*
                ──────────────────────────────────────────────────────────
                 THE BAND YOU ADVERTISE (migration 0035).

                 The fee itself is still yours to set per order — §14.3 has
                 not changed, because in Douala the price depends on the
                 quartier and the courier's judgement. What has changed is
                 that the customer no longer sees only "to be confirmed":
                 these two numbers appear on your page and at checkout,
                 BEFORE they commit.

                 Which means the maximum is a promise, and it is enforced —
                 the confirmation dialog will not let you quote above it,
                 and neither will the server. Leave it empty if you cannot
                 commit to a ceiling.
                ──────────────────────────────────────────────────────────
              */}
              <Field
                label={t("mpf.minDeliveryFee")}
                htmlFor="rp-minfee"
                hint={t("mpf.minDeliveryFeeHint")}
              >
                <Input
                  id="rp-minfee"
                  inputMode="numeric"
                  suffix="FCFA"
                  placeholder={t("mpf.feeNotSet")}
                  value={draft.minDeliveryFee}
                  disabled={pending || !draft.acceptsDelivery}
                  onChange={(e) => patch({ minDeliveryFee: e.target.value })}
                />
              </Field>

              <Field
                label={t("mpf.maxDeliveryFee")}
                htmlFor="rp-maxfee"
                hint={t("mpf.maxDeliveryFeeHint")}
              >
                <Input
                  id="rp-maxfee"
                  inputMode="numeric"
                  suffix="FCFA"
                  placeholder={t("mpf.feeNotSet")}
                  value={draft.maxDeliveryFee}
                  disabled={pending || !draft.acceptsDelivery}
                  onChange={(e) => patch({ maxDeliveryFee: e.target.value })}
                />
              </Field>

              <div className="flex flex-col gap-4 sm:col-span-2">
                <Switch
                  label={t("mpf.acceptsDelivery")}
                  description={t("mpf.acceptsDeliveryDesc")}
                  checked={draft.acceptsDelivery}
                  disabled={pending}
                  onChange={(e) => patch({ acceptsDelivery: e.target.checked })}
                />
                <Switch
                  label={t("mpf.acceptsPickup")}
                  description={t("mpf.acceptsPickupDesc")}
                  checked={draft.acceptsPickup}
                  disabled={pending}
                  onChange={(e) => patch({ acceptsPickup: e.target.checked })}
                />

                {noChannel && (
                  <p
                    role="status"
                    className="rounded-md border border-warning/30 bg-warning-light p-3 text-sm text-warning"
                  >
                    {t("mpf.noChannel")}
                  </p>
                )}
              </div>
            </CardBody>
          </Panel>
        </div>

        {/* ── Images ──────────────────────────────────────────────────── */}
        <aside className="min-w-0 lg:sticky lg:top-24">
          <Panel title={t("mpf.images")} description={t("mpf.imagesPending")}>
            <CardBody className="flex flex-col gap-7">
              <ImageUpload
                label={t("mpf.logo")}
                shape="square"
                hint={t("mpf.logoHint")}
                previewUrl={previewOf(logo, profile.logoUrl)}
                dirty={logo !== null}
                disabled={pending}
                onSelect={logoSlot.onSelect}
                onUndo={logoSlot.onUndo}
                onRemove={logoSlot.onRemove}
              />

              <ImageUpload
                label={t("mpf.cover")}
                shape="wide"
                hint={t("mpf.coverHint")}
                previewUrl={previewOf(cover, profile.coverUrl)}
                dirty={cover !== null}
                disabled={pending}
                onSelect={coverSlot.onSelect}
                onUndo={coverSlot.onUndo}
                onRemove={coverSlot.onRemove}
              />

              {/* §9 — an upload is judged by its actual bytes, not by the name
                  or the MIME type the browser claims for it. */}
              <p className="rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-secondary">
                {t("mpf.imagesNote")}
              </p>
            </CardBody>
          </Panel>
        </aside>
      </div>

      {/*
        The save bar is the LAST CHILD of the page wrapper, not of a column, so
        `sticky bottom` keeps it against the bottom of the screen from the first
        scroll — on a phone the buttons are under the thumb the whole way down,
        and nothing on this page is ever reached by scrolling sideways.
      */}
      <div className="sticky bottom-4 z-50 mt-6 rounded-lg border border-primary bg-surface p-4 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              <span>
                {dirtyCount > 0 ? t("mpf.unsaved", { count: dirtyCount }) : t("mpf.noChanges")}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-text-light">{t("mpf.saveHint")}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={pending || dirtyCount === 0}
              className="w-full sm:w-auto"
              onClick={discard}
            >
              <span>{t("mpf.discard")}</span>
            </Button>
            <Button loading={pending} disabled={pending} className="w-full sm:w-auto" onClick={save}>
              <Save className="size-4" aria-hidden />
              <span>{t("common.save")}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function seedHours(profile: RestaurantProfile): HourDraft[] {
  return profile.hours.map((hour) => ({
    weekday: hour.weekday,
    open: hour.opensAt !== null,
    opensAt: hour.opensAt ?? "",
    closesAt: hour.closesAt ?? "",
  }));
}

/** The lookup list, plus the row currently in use if it is no longer offered. */
function withCurrent(
  options: LookupOption[],
  currentId: string | null,
  currentName: string | null,
): LookupOption[] {
  if (!currentId || options.some((option) => option.id === currentId)) return options;
  return [...options, { id: currentId, name: currentName ?? currentId }];
}
