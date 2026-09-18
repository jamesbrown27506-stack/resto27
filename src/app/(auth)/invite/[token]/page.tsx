import type { BranchRole } from "@/lib/capabilities";
import Link from "next/link";
import { AuthHeading, AuthNotice } from "@/components/auth/auth-parts";
import { buttonClasses } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { fetchStaffInvitation } from "@/lib/auth/staff-invitations";
import { acceptStaffInvitation } from "@/lib/auth/staff-invite-actions";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";

export default async function AcceptInvitePage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const [invite, user, locale, t] = await Promise.all([fetchStaffInvitation(token), getSessionUser(), getLocale(), getTranslator()]);
  const en = locale === "en";
  if (!invite) return <><AuthHeading title={t("auth.invite.expired")} /><AuthNotice tone="error" title={t("auth.invite.expiredTitle")}><p>{t("auth.invite.expiredBody")}</p></AuthNotice><Link href="/account" className={buttonClasses({ fullWidth: true, className: "mt-5" })}>{en ? "My account" : "Mon compte"}</Link></>;
  const restaurant = Array.isArray(invite.restaurants) ? invite.restaurants[0] : invite.restaurants;
  const matches = user?.email?.toLowerCase() === invite.invited_email?.toLowerCase();
  const action = acceptStaffInvitation.bind(null, token);
  return <>
    <AuthHeading title={t("auth.invite.join")} />
    <div className="mb-5 rounded-md border border-border bg-surface-2 p-4">
      <p className="font-semibold">{restaurant?.name} {restaurant?.branch_label}</p>
      <p className="mt-2 text-sm">{t(`common.role.${invite.role as BranchRole}`)}</p>
      <p className="mt-2 break-words text-sm text-text-secondary">{invite.invited_email}</p>
    </div>
    {error && <AuthNotice tone="error" title={en ? "Unable to accept this invitation" : "Impossible d’accepter cette invitation"}><p>{en ? "Use the invited email address, verify your email, and try again. If the link has expired, ask the restaurant for a new invitation." : "Utilisez l’adresse invitée, confirmez votre e-mail et réessayez. Si le lien a expiré, demandez une nouvelle invitation au restaurant."}</p></AuthNotice>}
    {user ? matches && user.email_confirmed_at ? <form action={action}><button type="submit" className={buttonClasses({ fullWidth: true, size: "lg", className: "mt-5" })}>{t("auth.invite.accept")}</button></form> : <AuthNotice tone="error" title={en ? "Check your account" : "Vérifiez votre compte"}><p>{en ? "Sign out and sign in with the invited email address. Confirm that email before accepting." : "Déconnectez-vous puis connectez-vous avec l’adresse invitée. Confirmez cet e-mail avant d’accepter."}</p></AuthNotice> : <>
      <p className="mb-5 text-sm text-text-secondary">{en ? "Sign in with the invited email address. If you need an account, create one with that address; your invitation will appear in My account after email verification." : "Connectez-vous avec l’adresse invitée. Si nécessaire, créez un compte avec cette adresse ; votre invitation apparaîtra dans Mon compte après confirmation de l’e-mail."}</p>
      <Link href={"/login?next=" + encodeURIComponent("/invite/" + token)} className={buttonClasses({ fullWidth: true, size: "lg" })}>{t("auth.signIn")}</Link>
      <Link href="/register" className={buttonClasses({ fullWidth: true, className: "mt-3" })}>{t("auth.createAccount")}</Link>
    </>}
  </>;
}
