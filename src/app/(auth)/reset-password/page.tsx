"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  AuthHeading,
  AuthNotice,
  PasswordInput,
  PasswordStrength,
  passwordMeetsPolicy,
} from "@/components/auth/auth-parts";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { updatePassword, type AuthState } from "@/lib/auth/actions";
import { useLocale } from "@/lib/i18n/use-locale";

const INITIAL: AuthState = { ok: false };

/**
 * Set a new password.
 *
 * Reached from the emailed link via /auth/callback, which exchanges the
 * one-time code for a session. There is no token in this URL — the session IS
 * the proof, which is why an expired or already-used link lands on
 * /reset-password/expired instead of here.
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, formAction, pending] = useActionState(updatePassword, INITIAL);
  const { t } = useLocale();

  const mismatch = confirm.length > 0 && confirm !== password;

  if (state.error === "expired") {
    return (
      <>
        <AuthHeading title={t("auth.reset.expired")} />
        <AuthNotice tone="error" title={t("auth.reset.expiredTitle")}>
          <p>{t("auth.reset.expiredBody")}</p>
        </AuthNotice>
        <Link
          href="/forgot-password"
          className={buttonClasses({ fullWidth: true, size: "lg", className: "mt-6" })}
        >
          {t("auth.reset.requestNew")}
        </Link>
      </>
    );
  }

  if (state.done) {
    return (
      <>
        <AuthHeading title={t("auth.reset.done")} />
        <AuthNotice tone="success" title={t("auth.reset.doneTitle")}>
          <p>{t("auth.reset.doneBody")}</p>
        </AuthNotice>
        <Link
          href="/login"
          className={buttonClasses({ fullWidth: true, size: "lg", className: "mt-6" })}
        >
          {t("auth.signIn")}
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title={t("auth.reset.title")} subtitle={t("auth.reset.subtitle")} />

      {state.error && state.error !== "expired" && (
        <div className="mb-5">
          <AuthNotice tone="error" title={state.error} />
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <Field
          label={t("auth.reset.newPassword")}
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

        <Field
          label={t("auth.reset.confirm")}
          htmlFor="confirm"
          required
          error={mismatch ? t("auth.reset.mismatch") : state.fieldErrors?.confirm}
        >
          <PasswordInput
            id="confirm"
            name="confirm"
            required
            autoComplete="new-password"
            invalid={mismatch || Boolean(state.fieldErrors?.confirm)}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>

        <div className="mt-1 flex items-start gap-2.5 rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <p>{t("auth.reset.sessionNote")}</p>
        </div>

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!passwordMeetsPolicy(password) || password !== confirm}
          className="mt-1"
        >
          {t("auth.reset.save")}
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
