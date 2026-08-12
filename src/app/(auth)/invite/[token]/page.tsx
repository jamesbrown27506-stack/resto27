"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Store } from "lucide-react";
import {
  AuthHeading,
  AuthNotice,
  PasswordInput,
  PasswordStrength,
  passwordMeetsPolicy,
} from "@/components/auth/auth-parts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { BRANCH_ROLE_DESCRIPTION, BRANCH_ROLE_LABEL } from "@/lib/capabilities";
import { formatDate } from "@/lib/format/datetime";

/**
 * Staff invitation acceptance (§14.2).
 *
 * Two rules this screen exists to honour:
 *
 *  1. THE INVITEE SETS THEIR OWN PASSWORD. Nobody else ever knows it — not the
 *     restaurant owner who sent the invite, not us. An invite flow that mails a
 *     temporary password hands a working credential to whoever reads that
 *     mailbox.
 *  2. AN EXISTING ACCOUNT MAY NOT BE ABSORBED WITHOUT CONSENT. If the address
 *     already has an account, we ask them to sign in and accept — we do not
 *     silently attach their identity to a restaurant they never agreed to join.
 *
 * The token is stored server-side as a sha256 digest, so a database leak does
 * not yield usable invitation links.
 */
export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Fixture branches, reachable by token value.
  const expired = token === "expired";
  const existingAccount = token === "existing";

  const invite = {
    email: "nadege@chezmarcel.cm",
    restaurantName: "Chez Marcel",
    branchLabel: "Akwa",
    role: "cashier" as const,
    invitedBy: "Paul Mbarga",
    expiresAt: "2026-08-08T09:00:00Z",
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      setDone(true);
    }, 700);
  }

  if (expired) {
    return (
      <>
        <AuthHeading title="Invitation expirée" />
        <AuthNotice tone="error" title="Ce lien n'est plus valable">
          <p>
            Les invitations expirent au bout de sept jours. Demandez à votre responsable de vous en
            envoyer une nouvelle.
          </p>
        </AuthNotice>
        <Link href="/login" className={buttonClasses({ fullWidth: true, size: "lg" })}>
          Aller à la connexion
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthHeading title="Bienvenue dans l'équipe" />
        <AuthNotice tone="success" title="Invitation acceptée">
          <p>
            Vous faites maintenant partie de l&apos;équipe de {invite.restaurantName} —{" "}
            {invite.branchLabel}, avec le rôle {BRANCH_ROLE_LABEL[invite.role].toLowerCase()}.
          </p>
        </AuthNotice>
        <Link href="/login" className={buttonClasses({ fullWidth: true, size: "lg" })}>
          Se connecter
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="Rejoindre l'équipe" />

      <div className="mb-6 rounded-md border border-border bg-surface-2 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">
            <Store className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-display font-bold">
              {invite.restaurantName}
              <span className="ml-1.5 text-sm font-normal text-text-light">
                {invite.branchLabel}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">
              Invitation envoyée par {invite.invitedBy}
            </p>
            <div className="mt-2.5">
              <Badge tone="primary">{BRANCH_ROLE_LABEL[invite.role]}</Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-light">
              {BRANCH_ROLE_DESCRIPTION[invite.role]}
            </p>
          </div>
        </div>
        <p className="mt-3 border-t border-border pt-3 text-xs text-text-light">
          Cette invitation expire le {formatDate(invite.expiresAt)}.
        </p>
      </div>

      {existingAccount ? (
        <>
          <AuthNotice tone="info" title="Un compte existe déjà pour cette adresse">
            <p>
              Connectez-vous avec <strong>{invite.email}</strong> pour accepter cette invitation.
              Nous ne rattachons jamais un compte existant à un établissement sans votre accord
              explicite.
            </p>
          </AuthNotice>
          <Link
            href="/login"
            className={buttonClasses({ fullWidth: true, size: "lg", className: "mt-5" })}
          >
            Se connecter pour accepter
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Adresse email" htmlFor="email" hint="Définie par l'invitation.">
            <Input id="email" value={invite.email} readOnly disabled />
          </Field>

          <Field label="Nom complet" htmlFor="name" required>
            <Input id="name" name="name" required autoComplete="name" placeholder="Nadège Tchoumi" />
          </Field>

          <Field
            label="Choisissez votre mot de passe"
            htmlFor="password"
            required
            hint="Vous seul le connaîtrez — il n'est jamais communiqué au restaurant."
          >
            <PasswordInput
              id="password"
              name="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordStrength value={password} />
          </Field>

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={loading}
            disabled={!passwordMeetsPolicy(password)}
            className="mt-2"
          >
            Accepter et rejoindre
          </Button>
        </form>
      )}
    </>
  );
}
