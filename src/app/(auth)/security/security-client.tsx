"use client";

import Image from "next/image";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/use-locale";
import { disableOwnAuthenticator, enrollOwnAuthenticator, sendOwnEmailCode, verifyOwnAuthenticator, verifyOwnEmailCode, type SecurityResult } from "@/lib/auth/security-actions";

const copy = {
  fr: {
    title: "Sécurité du compte", intro: "Vérifiez votre adresse email. L’authentification en deux étapes (2FA) est facultative pour tous les comptes.", emailOptional: "La vérification de l’adresse email et la 2FA sont facultatives pour votre compte.",
    email: "Vérification de l’adresse", send: "Recevoir un code par email", resend: "Vérifier à nouveau mon adresse", verify: "Vérifier le code", sent: "Un code et un lien de vérification ont été envoyés à votre adresse.", done: "Adresse vérifiée. Vous pouvez continuer.",
    emailHint: "Saisissez le code reçu par email, ou ouvrez le lien dans le message.", emailPlaceholder: "Code reçu par email",
    mfa: "Authentification en deux étapes · Facultative", optional: "Vous pouvez utiliser votre compte sans cette option. Si vous l’activez, un code de votre application d’authentification sera demandé lors de vos prochaines connexions.",
    setup: "Activer la 2FA", needsEmail: "Vérifiez d’abord votre adresse email si vous souhaitez activer cette option.", scan: "Scannez ce QR code dans votre application d’authentification, puis saisissez son code à six chiffres.",
    code: "Code de vérification", appCode: "Code de l’application", appPlaceholder: "6 chiffres", challenge: "Vous avez activé la 2FA. Saisissez le code de votre application pour terminer la connexion.", confirm: "Confirmer le code", enabled: "2FA activée. Connexion vérifiée.",
    disable: "Désactiver la 2FA", disableAsk: "Désactiver l’authentification en deux étapes ? Vos prochaines connexions utiliseront uniquement votre mot de passe.", disableConfirm: "Confirmer la désactivation", cancel: "Annuler", disabled: "2FA désactivée.",
    continue: "Continuer", skip: "Continuer sans 2FA", signout: "Se déconnecter",
    errors: { identity: "Connectez-vous avec un compte actif et vérifiez votre adresse.", rate: "Trop de tentatives. Réessayez plus tard.", unavailable: "La vérification est indisponible. Réessayez plus tard.", code: "Code incorrect ou expiré. Vérifiez les chiffres ou demandez un nouveau code.", recentEmail: "Vérifiez de nouveau votre adresse par email avant de configurer la 2FA.", alreadyEnrolled: "Utilisez votre application d’authentification déjà configurée.", authenticatorRequired: "Confirmez d’abord le code de votre application pour désactiver la 2FA." },
  },
  en: {
    title: "Account security", intro: "Verify your email address. Two-factor authentication (2FA) is optional for every account.", emailOptional: "Email verification and 2FA are optional for your account.",
    email: "Email verification", send: "Send an email code", resend: "Verify my email again", verify: "Verify code", sent: "A code and verification link have been sent to your email.", done: "Email verified. You can continue.",
    emailHint: "Enter the code from your email, or open the link in the message.", emailPlaceholder: "Code from your email",
    mfa: "Two-factor authentication · Optional", optional: "You can use your account without this option. If you enable it, you will need a code from your authenticator app when you next sign in.",
    setup: "Enable 2FA", needsEmail: "Verify your email first if you want to enable this option.", scan: "Scan this QR code in your authenticator app, then enter its six-digit code.",
    code: "Verification code", appCode: "Authenticator code", appPlaceholder: "6 digits", challenge: "You enabled 2FA. Enter the code from your authenticator app to finish signing in.", confirm: "Confirm code", enabled: "2FA enabled. Sign-in verified.",
    disable: "Disable 2FA", disableAsk: "Disable two-factor authentication? Future sign-ins will use only your password.", disableConfirm: "Confirm disable", cancel: "Cancel", disabled: "2FA disabled.",
    continue: "Continue", skip: "Continue without 2FA", signout: "Sign out",
    errors: { identity: "Sign in with an active account and verify your email.", rate: "Too many attempts. Try again later.", unavailable: "Verification is unavailable. Try again later.", code: "Incorrect or expired code. Check the digits or request a new code.", recentEmail: "Verify your email again before setting up 2FA.", alreadyEnrolled: "Use your already configured authenticator app.", authenticatorRequired: "Confirm your authenticator code before disabling 2FA." },
  },
};

export function SecurityClient(props: { email: string; verified: boolean; factors: { id: string; name: string }[]; assured: boolean; emailRequired: boolean; next: string }) {
  const { locale } = useLocale();
  const text = copy[locale];
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [enrollment, setEnrollment] = useState<SecurityResult | null>(null);
  const verified = props.verified || emailVerified;
  const hasAuthenticator = !disabled && (props.factors.length > 0 || mfaVerified);
  const assured = props.assured || mfaVerified;
  function run(action: () => Promise<SecurityResult>, done: (result: SecurityResult) => void) {
    setError("");
    start(async () => { try { const result = await action(); if (!result.ok) setError(text.errors[result.error ?? "unavailable"]); else done(result); } catch { setError(text.errors.unavailable); } });
  }
  const factorId = enrollment?.factorId ?? (!disabled ? props.factors[0]?.id : undefined);
  const field = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-text";
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">{text.title}</h1><p className="mt-2 text-text-secondary">{props.emailRequired ? text.intro : text.emailOptional}</p></div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    <section className="space-y-3"><h2 className="font-semibold">{text.email}</h2><p className="break-all text-sm">{props.email}</p>
      {verified && <p role="status" className="text-sm text-success">{text.done}</p>}
      <Button loading={pending} variant={verified ? "outline" : "primary"} onClick={() => run(sendOwnEmailCode, () => setSent(true))}>{verified ? text.resend : text.send}</Button>
      {sent && <p role="status" className="text-sm text-text-secondary">{text.sent}</p>}
      {/* Keep this form available after refresh: a previously sent code is still usable. */}
      {(!verified || sent) && <form noValidate className="space-y-3" onSubmit={e => {
        e.preventDefault();
        const code = emailCode.trim().replace(/[\s-]/g, "");
        if (!/^\d{6,10}$/.test(code)) { setError(text.errors.code); return; }
        run(() => verifyOwnEmailCode(code), () => { setEmailVerified(true); setSent(false); setEmailCode(""); router.refresh(); });
      }}>
        <label htmlFor={`${id}-email`} className="block text-sm">{text.code}</label>
        <input id={`${id}-email`} name="emailCode" aria-describedby={`${id}-email-hint`} className={field} inputMode="numeric" autoComplete="one-time-code" maxLength={20} placeholder={text.emailPlaceholder} disabled={pending} value={emailCode} onChange={e => setEmailCode(e.target.value)} />
        <p id={`${id}-email-hint`} className="text-sm text-text-secondary">{text.emailHint}</p>
        <Button type="submit" loading={pending}>{text.verify}</Button>
      </form>}
    </section>
    <section className="space-y-3"><h2 className="font-semibold">{text.mfa}</h2><p className="text-sm text-text-secondary">{text.optional}</p>
      {disabled && <p role="status" className="text-sm text-success">{text.disabled}</p>}
      {!verified ? <p className="text-sm text-text-secondary">{text.needsEmail}</p> : hasAuthenticator && assured ? <>
        <p role="status" className="text-sm text-success">{text.enabled}</p>
        {confirmDisable ? <div className="space-y-3 rounded-lg border border-border p-3"><p className="text-sm">{text.disableAsk}</p><div className="flex flex-wrap gap-2">
          <Button variant="danger" loading={pending} onClick={() => run(disableOwnAuthenticator, () => { setDisabled(true); setMfaVerified(false); setEnrollment(null); setConfirmDisable(false); router.refresh(); })}>{text.disableConfirm}</Button>
          <Button variant="outline" disabled={pending} onClick={() => setConfirmDisable(false)}>{text.cancel}</Button>
        </div></div> : <Button variant="outline" disabled={pending} onClick={() => setConfirmDisable(true)}>{text.disable}</Button>}
      </> : <>
        {!factorId && <Button loading={pending} onClick={() => run(enrollOwnAuthenticator, result => { setDisabled(false); setEnrollment(result); })}>{text.setup}</Button>}
        {enrollment?.qrCode && <><p className="text-sm text-text-secondary">{text.scan}</p>{/* Auth-generated data image, never injected as HTML. */}
          <Image unoptimized src={enrollment.qrCode} width={220} height={220} alt="Authenticator QR code" /><p className="break-all font-mono text-sm">{enrollment.secret}</p></>}
        {factorId && <form noValidate className="space-y-3" onSubmit={e => {
          e.preventDefault();
          const code = mfaCode.trim().replace(/[\s-]/g, "");
          if (!/^\d{6}$/.test(code)) { setError(text.errors.code); return; }
          run(() => verifyOwnAuthenticator(factorId, code), () => { setMfaVerified(true); setMfaCode(""); setEnrollment(null); router.refresh(); });
        }}>
          {hasAuthenticator && <p className="text-sm text-text-secondary">{text.challenge}</p>}
          <label htmlFor={`${id}-mfa`} className="block text-sm">{text.appCode}</label>
          <input id={`${id}-mfa`} name="mfaCode" className={field} inputMode="numeric" autoComplete="one-time-code" maxLength={12} placeholder={text.appPlaceholder} disabled={pending} value={mfaCode} onChange={e => setMfaCode(e.target.value)} />
          <Button type="submit" loading={pending}>{text.confirm}</Button>
        </form>}
      </>}
    </section>
    {(!props.emailRequired || verified) && (!hasAuthenticator || assured) && <Button disabled={pending} onClick={() => { router.replace(props.next); router.refresh(); }}>{hasAuthenticator ? text.continue : text.skip}</Button>}
    <form method="post" action="/logout"><Button type="submit" variant="ghost" disabled={pending}>{text.signout}</Button></form>
  </div>;
}
