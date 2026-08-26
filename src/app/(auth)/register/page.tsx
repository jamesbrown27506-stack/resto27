"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Mail, Phone, User } from "lucide-react";
import {
  AuthHeading,
  AuthNotice,
  PasswordInput,
  PasswordStrength,
  passwordMeetsPolicy,
} from "@/components/auth/auth-parts";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { signUpCustomer, type AuthState } from "@/lib/auth/actions";
import { useLocale } from "@/lib/i18n/use-locale";

const INITIAL: AuthState = { ok: false };

export default function RegisterPage() {
  /*
    ALL FOUR FIELDS ARE CONTROLLED, NOT JUST THE PASSWORD.

    The password was already held here so the strength meter could read it,
    which meant a rejected sign-up kept the one field people mind least about
    retyping and emptied the three they mind most — name, email and phone,
    gone because React resets an uncontrolled form once its action returns.
    On a phone that is the difference between correcting a typo and filling
    the form again.
  */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [state, formAction, pending] = useActionState(signUpCustomer, INITIAL);
  const { t } = useLocale();

  if (state.done) {
    return (
      <>
        <AuthHeading title={t("auth.checkEmail")} />
        <AuthNotice tone="success" title={t("auth.accountCreated")}>
          <p>{t("auth.checkEmailBody")}</p>
        </AuthNotice>
        <p className="mt-5 text-sm leading-relaxed text-text-secondary">{t("auth.checkSpam")}</p>
        <Link
          href="/login"
          className={buttonClasses({ fullWidth: true, size: "lg", className: "mt-6" })}
        >
          {t("auth.goToLogin")}
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title={t("auth.createAccount")} subtitle={t("auth.register.subtitle")} />

      {state.error && (
        <div className="mb-5">
          <AuthNotice tone="error" title={state.error} />
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <Field label={t("auth.name")} htmlFor="name" required error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            icon={<User />}
            invalid={Boolean(state.fieldErrors?.name)}
            placeholder="Marie Ngo"
          />
        </Field>

        <Field label={t("auth.email")} htmlFor="email" required error={state.fieldErrors?.email}>
          <Input
            id="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
            icon={<Mail />}
            invalid={Boolean(state.fieldErrors?.email)}
            placeholder="vous@exemple.cm"
          />
        </Field>

        <Field
          label={t("auth.phone")}
          htmlFor="phone"
          required
          hint={t("auth.phoneHint")}
          error={state.fieldErrors?.phone}
        >
          <Input
            id="phone"
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            required
            autoComplete="tel"
            icon={<Phone />}
            invalid={Boolean(state.fieldErrors?.phone)}
            placeholder="+237 6 99 12 34 56"
          />
        </Field>

        <Field
          label={t("auth.password")}
          htmlFor="password"
          required
          error={state.fieldErrors?.password}
        >
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={Boolean(state.fieldErrors?.password)}
          />
          <PasswordStrength value={password} />
        </Field>

        <Checkbox
          name="terms"
          required
          className="mt-1"
          label={
            <>
              {t("auth.acceptTerms1")}{" "}
              <Link href="/terms" className="font-semibold text-primary hover:underline">
                {t("auth.termsLink")}
              </Link>{" "}
              {t("auth.andPrivacy")}{" "}
              <Link href="/privacy" className="font-semibold text-primary hover:underline">
                {t("auth.privacyLink")}
              </Link>
              .
            </>
          }
        />
        {state.fieldErrors?.terms && (
          <p role="alert" className="-mt-2 text-xs font-medium text-error">
            {state.fieldErrors.terms}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!passwordMeetsPolicy(password)}
          className="mt-2"
        >
          {t("auth.createAccountBtn")}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-text-secondary">
        {t("auth.alreadyHave")}{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          {t("auth.signInLink")}
        </Link>
      </p>
    </>
  );
}
