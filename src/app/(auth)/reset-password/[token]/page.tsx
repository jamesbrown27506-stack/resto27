import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthHeading, AuthNotice } from "@/components/auth/auth-parts";
import { buttonClasses } from "@/components/ui/button";

/**
 * The dead-link state.
 *
 * /auth/callback sends people here as `/reset-password/expired` when the
 * one-time code fails to exchange — expired, already used, or tampered with.
 *
 * Anything else in this position is an old-style link with a token in the
 * path. Those no longer carry the session, so the only sensible thing is to
 * forward to the real form, which will itself report expiry if there is no
 * session behind it.
 */
export default async function ResetPasswordTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (token !== "expired") redirect("/reset-password");

  return (
    <>
      <AuthHeading title="Lien expiré" />
      <AuthNotice tone="error" title="Ce lien n'est plus valable">
        <p>
          Les liens de réinitialisation expirent au bout d&apos;une heure et ne peuvent servir
          qu&apos;une seule fois. Demandez-en un nouveau.
        </p>
      </AuthNotice>
      <Link
        href="/forgot-password"
        className={buttonClasses({ fullWidth: true, size: "lg", className: "mt-6" })}
      >
        Demander un nouveau lien
      </Link>
    </>
  );
}
