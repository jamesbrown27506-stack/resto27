"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useState } from "react";
import { Mail } from "lucide-react";
import {
  AuthHeading,
  LoginReasonAlert,
  PasswordInput,
  type LoginReason,
} from "@/components/auth/auth-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { signIn, type AuthState } from "@/lib/auth/actions";
import { useLocale } from "@/lib/i18n/use-locale";

const VALID_REASONS: LoginReason[] = ["invalid", "pending", "pending-manager", "suspended"];
const INITIAL: AuthState = { ok: false };

function LoginForm() {
  const params = useSearchParams();
  const { t } = useLocale();
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  /*
    ─────────────────────────────────────────────────────────────────────────
     A REJECTED SIGN-IN NO LONGER EMPTIES THE FORM.

     React resets an UNCONTROLLED form after a form action completes — that is
     the documented behaviour, and it is correct for a form that succeeded.
     For one that failed it is punishing: the person mistyped one character of
     a password and got back two blank boxes, so the fix for a typo was to type
     the whole thing again, on a phone, possibly several times.

     Holding both fields in React state is what stops it. The values never
     leave the component, so there is nothing for the action's return to clear.

     AND THE PASSWORD IS DELIBERATELY NOT ROUND-TRIPPED THROUGH THE SERVER.
     The obvious alternative — echo the submitted values back on the failed
     AuthState — would put a plaintext password in the server's response and
     then in a `value` attribute in the DOM. Keeping it client-side gives the
     same result for the person typing and never sends the secret anywhere it
     was not already going.
    ─────────────────────────────────────────────────────────────────────────
  */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // A reason can arrive two ways: from the action that just ran, or in the URL
  // when a guard bounced someone here mid-session.
  const fromUrl = params.get("reason");
  const reason =
    state.reason ??
    (VALID_REASONS.includes(fromUrl as LoginReason) ? (fromUrl as LoginReason) : null);

  return (
    <>
      <AuthHeading title={t("auth.login.title")} subtitle={t("auth.login.subtitle")} />

      {reason && <LoginReasonAlert reason={reason} />}

      <form action={formAction} className="flex flex-col gap-4">
        {/* Where the proxy wanted them to go. Validated server-side as a
            same-site path before any redirect happens. */}
        <input type="hidden" name="next" value={params.get("next") ?? ""} />

        <Field
          label={t("auth.email")}
          htmlFor="email"
          required
          error={state.fieldErrors?.email}
        >
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
            autoComplete="current-password"
            invalid={Boolean(state.fieldErrors?.password)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Switch name="remember" label={t("auth.remember")} defaultChecked />
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            {t("auth.forgot")}
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={pending} className="mt-2">
          {t("auth.signIn")}
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-text-secondary">
        {t("auth.noAccount")}{" "}
        <Link href="/register" className="font-semibold text-primary hover:underline">
          {t("auth.createAccount")}
        </Link>
      </p>

      <p className="mt-3 text-center text-sm text-text-light">
        {t("auth.areYouOwner")}{" "}
        <Link
          href="/register/restaurant"
          className="font-medium text-text-secondary hover:text-primary"
        >
          {t("auth.registerRestaurant")}
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LoginForm />
    </Suspense>
  );
}
