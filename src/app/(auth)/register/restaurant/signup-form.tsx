"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock, Mail, MapPin, Phone, Store, User } from "lucide-react";
import {
  AuthHeading,
  AuthNotice,
  PasswordInput,
  PasswordStrength,
  passwordMeetsPolicy,
} from "@/components/auth/auth-parts";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { signUpRestaurant, type AuthState } from "@/lib/auth/actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { SignupArea } from "@/lib/data/signup";
import { cn } from "@/lib/utils";

/**
 * Creates the user AND the restaurant, both `pending`. The flow ends on an
 * explicit "awaiting approval" screen rather than dropping the applicant at a
 * login that will refuse them — /login's `pending-manager` state is the other
 * half of that same promise.
 *
 * Split into steps because a single long form is where restaurant signups are
 * abandoned. The step inputs carry no `name`; the review step emits hidden
 * inputs instead, so one submit posts the whole application and no `required`
 * field is ever hidden from the browser's validation.
 */

const INITIAL: AuthState = { ok: false };

/**
 * Which step owns each field.
 *
 * Server-side validation errors are rendered next to their input — but on the
 * review step none of those inputs are on screen, so a rejected submission
 * used to look like nothing at all had happened. This maps every error back to
 * the step that can fix it, so the review step can list them and offer to jump.
 */
const FIELD_STEP: Record<string, number> = {
  ownerName: 0,
  email: 0,
  phone: 0,
  password: 0,
  restaurantName: 1,
  description: 1,
  serviceAreaId: 2,
  quartier: 2,
  address: 2,
  restaurantPhone: 2,
};

export function RestaurantSignupForm({ areas }: { areas: SignupArea[] }) {
  const { t } = useLocale();

  const [step, setStep] = useState(0);
  const [password, setPassword] = useState("");
  /**
   * CONTROLLED, and that is the fix.
   *
   * React 19 resets uncontrolled fields in a form once its action completes.
   * The terms box was uncontrolled, so every rejected submission cleared it —
   * which read as "the button unticked my box and did nothing", when what had
   * actually happened was a validation failure the review step never showed.
   */
  const [accepted, setAccepted] = useState(false);
  const [state, formAction, pending] = useActionState(signUpRestaurant, INITIAL);

  const [form, setForm] = useState({
    ownerName: "",
    email: "",
    phone: "",
    restaurantName: "",
    description: "",
    // Preselected when there is only one open city — asking someone to choose
    // from a list of one is a pointless click.
    serviceAreaId: areas.length === 1 ? areas[0]!.id : "",
    quartier: "",
    address: "",
    restaurantPhone: "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const STEPS = [t("reg.step.you"), t("reg.step.place"), t("reg.step.location"), t("reg.step.review")];

  const selectedArea = areas.find((a) => a.id === form.serviceAreaId) ?? null;

  const stepValid = [
    form.ownerName && form.email && form.phone && passwordMeetsPolicy(password),
    Boolean(form.restaurantName),
    form.serviceAreaId && form.quartier && form.address && form.restaurantPhone,
    accepted,
  ][step];

  const fieldErrors = Object.entries(state.fieldErrors ?? {});

  /**
   * No open town means no application is possible.
   *
   * Said plainly, up front. The alternative is a town selector with nothing in
   * it and four steps to fill before discovering there is nowhere to submit
   * them.
   */
  if (areas.length === 0) {
    return (
      <>
        <AuthHeading title={t("reg.title")} />
        <AuthNotice tone="warning" title={t("reg.closed.title")}>
          <p>{t("reg.closed.body")}</p>
        </AuthNotice>
      </>
    );
  }

  if (state.done) {
    return (
      <>
        <AuthHeading title={t("reg.done.title")} />

        <AuthNotice tone="success" title={t("reg.done.heading")}>
          <p>{t("reg.done.body", { name: form.restaurantName || "—" })}</p>
        </AuthNotice>

        <ol className="mt-6 flex flex-col gap-4">
          {[
            {
              Icon: Check,
              title: t("reg.done.s1"),
              body: t("reg.done.s1body", { email: form.email || "—" }),
              done: true,
            },
            { Icon: Clock, title: t("reg.done.s2"), body: t("reg.done.s2body"), done: false },
            { Icon: Store, title: t("reg.done.s3"), body: t("reg.done.s3body"), done: false },
          ].map(({ Icon, title, body, done }) => (
            <li key={title} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                  done ? "bg-success text-white" : "bg-surface-2 text-text-light",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-sm text-text-secondary">{body}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-col gap-3">
          <Link href="/" className={buttonClasses({ variant: "outline", fullWidth: true })}>
            {t("reg.done.home")}
          </Link>
          <Link
            href="/contact"
            className="text-center text-sm font-medium text-text-secondary hover:text-primary"
          >
            {t("reg.done.question")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading title={t("reg.title")} subtitle={t("reg.subtitle")} />

      {state.error && (
        <div className="mb-5">
          <AuthNotice tone="error" title={state.error} />
        </div>
      )}

      {/* Progress */}
      <ol className="mb-7 flex items-center gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span
              className={cn(
                "h-1 rounded-full transition-colors",
                i <= step ? "bg-primary" : "bg-border",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-bold tracking-wide uppercase transition-colors",
                i <= step ? "text-primary" : "text-text-light",
              )}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <form action={formAction}>
        <div className="flex flex-col gap-4">
          {step === 0 && (
            <>
              <Field label={t("reg.ownerName")} htmlFor="ownerName" required error={state.fieldErrors?.ownerName}>
                <Input
                  id="ownerName"
                  icon={<User />}
                  value={form.ownerName}
                  onChange={(e) => set("ownerName", e.target.value)}
                  autoComplete="name"
                  placeholder={t("reg.ownerNamePh")}
                />
              </Field>
              <Field label={t("reg.yourEmail")} htmlFor="email" required error={state.fieldErrors?.email}>
                <Input
                  id="email"
                  type="email"
                  icon={<Mail />}
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="email"
                  placeholder={t("reg.yourEmailPh")}
                />
              </Field>
              <Field label={t("reg.yourPhone")} htmlFor="phone" required error={state.fieldErrors?.phone}>
                <Input
                  id="phone"
                  type="tel"
                  icon={<Phone />}
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  autoComplete="tel"
                  placeholder="+237 6 77 88 99 00"
                />
              </Field>
              <Field label={t("reg.password")} htmlFor="password" required error={state.fieldErrors?.password}>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <PasswordStrength value={password} />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <Field
                label={t("reg.restaurantName")}
                htmlFor="restaurantName"
                required
                error={state.fieldErrors?.restaurantName}
              >
                <Input
                  id="restaurantName"
                  icon={<Store />}
                  value={form.restaurantName}
                  onChange={(e) => set("restaurantName", e.target.value)}
                  placeholder={t("reg.restaurantNamePh")}
                />
              </Field>
              <Field label={t("reg.description")} htmlFor="description" hint={t("reg.descriptionHint")}>
                <Textarea
                  id="description"
                  rows={4}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder={t("reg.descriptionPh")}
                />
              </Field>
              <p className="rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-text-secondary">
                {t("reg.laterNote")}
              </p>
            </>
          )}

          {step === 2 && (
            <>
              {/*
                The town is a SELECT, the quartier is a DATALIST. That
                difference is deliberate.

                A town is a service area: it carries the currency, the timezone
                and whether we accept signups there at all, so it must be one
                of ours and a typed value would be meaningless.

                A neighbourhood is not. A closed list is wrong for Douala — the
                seeded names are the well-known few, and an applicant in a
                quartier we have not listed would either abandon the form or
                pick the nearest wrong answer, which then shows on their public
                page and misroutes every delivery. Anything typed is accepted
                and created inactive for an admin to promote from /a/areas.
              */}
              <Field label={t("reg.city")} htmlFor="serviceAreaId" required error={state.fieldErrors?.serviceAreaId}>
                <Select
                  id="serviceAreaId"
                  value={form.serviceAreaId}
                  onChange={(e) => {
                    set("serviceAreaId", e.target.value);
                    // The suggestions belong to the old town; keeping the value
                    // would offer a Douala quartier to a Yaoundé restaurant.
                    set("quartier", "");
                  }}
                >
                  <option value="">{t("reg.choose")}</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.city}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={t("reg.quartier")}
                htmlFor="quartier"
                required
                error={state.fieldErrors?.quartier}
                hint={selectedArea ? t("reg.quartierHint") : t("reg.quartierPickCity")}
              >
                <Input
                  id="quartier"
                  list="quartier-options"
                  autoComplete="off"
                  disabled={!selectedArea}
                  value={form.quartier}
                  onChange={(e) => set("quartier", e.target.value)}
                  placeholder={selectedArea?.quartiers.slice(0, 3).join(", ") || "Akwa, Bonapriso…"}
                />
                <datalist id="quartier-options">
                  {(selectedArea?.quartiers ?? []).map((q) => (
                    <option key={q} value={q} />
                  ))}
                </datalist>
              </Field>

              <Field label={t("reg.address")} htmlFor="address" required error={state.fieldErrors?.address}>
                <Input
                  id="address"
                  icon={<MapPin />}
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder={t("reg.addressPh")}
                />
              </Field>

              <Field
                label={t("reg.restaurantPhone")}
                htmlFor="restaurantPhone"
                required
                hint={t("reg.restaurantPhoneHint")}
                error={state.fieldErrors?.restaurantPhone}
              >
                <Input
                  id="restaurantPhone"
                  type="tel"
                  icon={<Phone />}
                  value={form.restaurantPhone}
                  onChange={(e) => set("restaurantPhone", e.target.value)}
                  placeholder="+237 6 99 11 22 33"
                />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              {/*
                THE ERRORS HAVE TO SURFACE HERE.

                Each field renders its own message beside the input — but on
                this step none of those inputs exist, so a rejected submission
                showed nothing whatsoever. This lists what failed and jumps
                back to the step that owns it.
              */}
              {fieldErrors.length > 0 && (
                <div
                  role="alert"
                  className="rounded-md border border-error/30 bg-error-light p-4 text-error"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    {t("reg.fixErrors")}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                    {fieldErrors.map(([key, message]) => (
                      <li key={key} className="flex flex-wrap items-center gap-2">
                        <span>{message}</span>
                        {FIELD_STEP[key] !== undefined && (
                          <button
                            type="button"
                            onClick={() => setStep(FIELD_STEP[key]!)}
                            className="font-semibold underline underline-offset-2"
                          >
                            {t("reg.goToStep")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <dl className="divide-y divide-border rounded-md border border-border">
                {[
                  [t("reg.review.owner"), form.ownerName],
                  [t("reg.review.email"), form.email],
                  [t("reg.review.phone"), form.phone],
                  [t("reg.review.restaurant"), form.restaurantName],
                  [t("reg.city"), selectedArea?.city ?? ""],
                  [t("reg.quartier"), form.quartier],
                  [t("reg.address"), form.address],
                  [t("reg.restaurantPhone"), form.restaurantPhone],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <dt className="text-sm text-text-secondary">{label}</dt>
                    <dd className="max-w-[55%] text-right text-sm font-medium break-words">
                      {value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>

              <Checkbox
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                label={
                  <>
                    {t("reg.terms1")}{" "}
                    <Link href="/terms" className="font-semibold text-primary hover:underline">
                      {t("reg.termsLink")}
                    </Link>{" "}
                    {t("reg.terms2")}
                  </>
                }
              />

              {/* The actual payload. Emitted only here, so no `required` input
                  is ever hidden from the browser's own validation. */}
              <input type="hidden" name="ownerName" value={form.ownerName} />
              <input type="hidden" name="email" value={form.email} />
              <input type="hidden" name="phone" value={form.phone} />
              <input type="hidden" name="password" value={password} />
              <input type="hidden" name="restaurantName" value={form.restaurantName} />
              <input type="hidden" name="description" value={form.description} />
              <input type="hidden" name="serviceAreaId" value={form.serviceAreaId} />
              <input type="hidden" name="quartier" value={form.quartier} />
              <input type="hidden" name="address" value={form.address} />
              <input type="hidden" name="restaurantPhone" value={form.restaurantPhone} />
            </>
          )}
        </div>

        <div className="mt-7 flex items-center gap-3">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={pending}>
              <ArrowLeft className="size-4" aria-hidden />
              {t("reg.back")}
            </Button>
          )}

          {step < STEPS.length - 1 ? (
            <Button fullWidth size="lg" disabled={!stepValid} onClick={() => setStep((s) => s + 1)}>
              {t("reg.continue")}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button type="submit" fullWidth size="lg" loading={pending} disabled={!accepted || pending}>
              {t("reg.submit")}
            </Button>
          )}
        </div>
      </form>

      <p className="mt-7 text-center text-sm text-text-secondary">
        {t("reg.haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          {t("reg.signIn")}
        </Link>
      </p>
    </>
  );
}
