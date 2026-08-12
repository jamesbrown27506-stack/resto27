"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { AuthHeading, AuthNotice } from "@/components/auth/auth-parts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset, type AuthState } from "@/lib/auth/actions";

const INITIAL: AuthState = { ok: false };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, formAction, pending] = useActionState(requestPasswordReset, INITIAL);

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
        <AuthHeading title="Vérifiez vos emails" />

        <AuthNotice tone="success" title="Demande enregistrée">
          <p>
            Si un compte existe pour <strong>{email || "cette adresse"}</strong>, un lien de
            réinitialisation vient d&apos;y être envoyé. Il est valable une heure et ne peut servir
            qu&apos;une fois.
          </p>
        </AuthNotice>

        <p className="mt-5 text-sm leading-relaxed text-text-secondary">
          Rien reçu au bout de quelques minutes ? Regardez dans les indésirables.
        </p>

        <Link
          href="/login"
          className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Retour à la connexion
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Mot de passe oublié"
        subtitle="Saisissez votre adresse email. Nous vous envoyons un lien pour en définir un nouveau."
      />

      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Adresse email" htmlFor="email" required error={state.fieldErrors?.email}>
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
          Envoyer le lien
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Retour à la connexion
      </Link>
    </>
  );
}
