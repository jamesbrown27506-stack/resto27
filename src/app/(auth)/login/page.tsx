"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
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
