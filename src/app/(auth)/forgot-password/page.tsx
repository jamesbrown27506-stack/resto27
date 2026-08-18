"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { AuthHeading, AuthNotice } from "@/components/auth/auth-parts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset, type AuthState } from "@/lib/auth/actions";
import { useLocale } from "@/lib/i18n/use-locale";

const INITIAL: AuthState = { ok: false };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState(requestPasswordReset, INITIAL);
  const { t } = useLocale();

  /**
   * ALWAYS reports success (§14.2), whether or not the address exists.
   *
   * Anything else is an account-enumeration oracle: an attacker submits a list
   * of addresses and the differing responses reveal which ones have accounts.
   * The copy is phrased so it is true either way — "if an account exists", not
   * "we sent you an email".
   */
  if (state.done) {
    return (
      <>
        <AuthHeading title={t("auth.checkEmail")} />

        <AuthNotice tone="success" title={t("auth.forgot.requested")}>
          <p>
            {t("auth.forgot.requestedBody", { email: email || t("auth.forgot.thisAddress") })}
          </p>
        </AuthNotice>

        <p className="mt-5 text-sm leading-relaxed text-text-secondary">{t("auth.forgot.spam")}</p>

        <Link
          href="/login"
          className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("auth.backToLogin")}
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title={t("auth.forgot.title")} subtitle={t("auth.forgot.subtitle")} />

      <form action={formAction} className="flex flex-col gap-4">
        <Field label={t("auth.email")} htmlFor="email" required error={state.fieldErrors?.email}>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            icon={<Mail />}
            invalid={Boolean(state.fieldErrors?.email)}
            placeholder="vous@exemple.cm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Button type="submit" size="lg" fullWidth loading={pending} className="mt-2">
          {t("auth.forgot.send")}
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {t("auth.backToLogin")}
      </Link>
    </>
  );
}
