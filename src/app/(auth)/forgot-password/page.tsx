"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import { AuthHeading, AuthNotice } from "@/components/auth/auth-parts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset, verifyResetCode, type AuthState } from "@/lib/auth/actions";
import { useLocale } from "@/lib/i18n/use-locale";

const INITIAL: AuthState = { ok: false };

/**
 * Forgot password — ask for the email, then take the CODE it carries.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A CODE, NOT ONLY A LINK.
 *
 *  A reset link has to leave the app and come back: on the Android app it
 *  opens in Chrome, not in the app; opened on another phone it had no session
 *  to finish with; and a misconfigured redirect list sent it to the landing
 *  page. A code is typed where the reset started — the same habit as a MoMo
 *  or Orange Money confirmation code. The email still carries a link for
 *  whoever prefers it (/auth/confirm).
 * ─────────────────────────────────────────────────────────────────────────
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState(requestPasswordReset, INITIAL);
  const [codeState, codeAction, verifying] = useActionState(verifyResetCode, INITIAL);
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

        {codeState.error && (
          <div className="mt-5">
            <AuthNotice tone="error" title={t("auth.forgot.codeInvalid")} />
          </div>
        )}

        <form action={codeAction} className="mt-5 flex flex-col gap-4">
          <input type="hidden" name="email" value={email} />
          <Field
            label={t("auth.forgot.codeLabel")}
            htmlFor="code"
            required
            error={codeState.fieldErrors?.code}
            hint={t("auth.forgot.codeHint")}
          >
            <Input
              id="code"
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              icon={<KeyRound />}
              placeholder="123456"
              invalid={Boolean(codeState.fieldErrors?.code || codeState.error)}
              className="tnum tracking-[0.3em]"
            />
          </Field>

          <Button type="submit" size="lg" fullWidth loading={verifying}>
            {t("auth.forgot.verify")}
          </Button>
        </form>

        <p className="mt-5 text-sm leading-relaxed text-text-secondary">{t("auth.forgot.spam")}</p>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("auth.backToLogin")}
          </Link>
          {/* A full reload is the reset: it drops both forms' state. */}
          <a href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            {t("auth.forgot.otherAddress")}
          </a>
        </div>
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
