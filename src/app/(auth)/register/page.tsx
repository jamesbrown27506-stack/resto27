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

const INITIAL: AuthState = { ok: false };

export default function RegisterPage() {
  const [password, setPassword] = useState("");
  const [state, formAction, pending] = useActionState(signUpCustomer, INITIAL);

  if (state.done) {
    return (
      <>
        <AuthHeading title="Vérifiez vos emails" />
        <AuthNotice tone="success" title="Compte créé">
          <p>
            Un lien de confirmation vient de vous être envoyé. Cliquez dessus pour activer votre
            compte, puis connectez-vous.
          </p>
        </AuthNotice>
        <p className="mt-5 text-sm leading-relaxed text-text-secondary">
          Rien reçu au bout de quelques minutes ? Regardez dans vos indésirables.
        </p>
        <Link
          href="/login"
          className={buttonClasses({ fullWidth: true, size: "lg", className: "mt-6" })}
        >
          Aller à la connexion
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Créer un compte"
        subtitle="Commandez, réservez et cumulez des points de fidélité. Votre panier en cours est conservé."
      />

      {state.error && (
        <div className="mb-5">
          <AuthNotice tone="error" title={state.error} />
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Nom complet" htmlFor="name" required error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            required
            autoComplete="name"
            icon={<User />}
            invalid={Boolean(state.fieldErrors?.name)}
            placeholder="Marie Ngo"
          />
        </Field>

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
          />
        </Field>

        <Field
          label="Téléphone"
          htmlFor="phone"
          required
          hint="Le restaurant vous joint sur ce numéro pour la livraison."
          error={state.fieldErrors?.phone}
        >
          <Input
            id="phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            icon={<Phone />}
            invalid={Boolean(state.fieldErrors?.phone)}
            placeholder="+237 6 99 12 34 56"
          />
        </Field>

        <Field
          label="Mot de passe"
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
              J&apos;accepte les{" "}
              <Link href="/terms" className="font-semibold text-primary hover:underline">
                conditions d&apos;utilisation
              </Link>{" "}
              et la{" "}
              <Link href="/privacy" className="font-semibold text-primary hover:underline">
                politique de confidentialité
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
          Créer mon compte
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-text-secondary">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Se connecter
        </Link>
      </p>
    </>
  );
}
