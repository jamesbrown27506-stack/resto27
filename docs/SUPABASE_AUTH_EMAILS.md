# Supabase auth emails: password reset and sign-up confirmation

Supabase sends two emails itself: the password reset and the sign-up confirmation. The app sends the rest through `src/lib/mail.ts`, which now wraps every message in the branded layout from `src/lib/email-layout.ts`. This guide covers the Supabase half, which you configure in the Supabase dashboard rather than in code.

## Why the reset link opened the landing page

The app asks Supabase to send people back to `https://resto237.online/auth/callback?next=/reset-password`. Supabase only honours addresses on its **Redirect URLs** allow-list. For anything else, it quietly falls back to the **Site URL**, which is the landing page. The one-time code then sits unused in the address bar.

There was a second trap even with the allow-list right. That link only works in the **same browser** that asked for the reset. Opened in the Gmail app, on another phone, or from the Android app (whose links open in Chrome), it reports "expired".

The fix is to install the templates below, which use two methods that avoid both problems:

- **a 6-digit code**, typed on the forgot-password screen (`verifyResetCode`)
- **a link to `/auth/confirm`**, which verifies a token hash on the server and works in any browser

## 1. URL configuration

In the dashboard, open **Authentication → URL Configuration** and set:

| Setting | Value |
|---|---|
| Site URL | `https://resto237.online` |
| Redirect URLs | `https://resto237.online/auth/callback` |
| | `https://resto237.online/auth/callback?next=**` |
| | `http://localhost:3000/**` (local testing) |

The templates build their links from `{{ .SiteURL }}`, so the Site URL must be the real domain.
The production entries keep the callback path fixed while allowing the app's
validated `next` destination in the query string. Do not allow every production
path or every Vercel hostname.

## 2. Email templates

In **Authentication → Emails → Templates**, set the subject and paste the HTML body. The HTML is everything after the comment at the top of each file.

| Template | Subject | Body |
|---|---|---|
| Reset Password | `Votre code Resto237 : {{ .Token }}` | `supabase/email-templates/reset-password.html` |
| Confirm signup | `Confirmez votre adresse email — Resto237` | `supabase/email-templates/confirm-signup.html` |
| Magic link or OTP | `Vérifiez votre adresse / Verify your Resto237 email` | `supabase/email-templates/verify-email.html` |

## 3. Code settings

In **Authentication → Providers → Email** (the name may differ slightly by dashboard version):

- **Email OTP Expiration:** `3600` seconds (one hour, as the emails say)
- **Email OTP Length:** `6`. The app accepts 6 to 10 digits, but 6 is what people expect.

## 4. Sender (custom SMTP)

In **Authentication → Emails → SMTP Settings**, enter the same SMTP credentials as the app's `SMTP_*` variables. Supabase's built-in sender is for trying things out: it is heavily rate-limited, and on current projects it only delivers to your own team's addresses. Using one sender for both halves means one reputation and one place to look when a message goes missing.

## Test it

1. Open `/forgot-password`, enter your email, and press **Recevoir le code**.
2. The email shows a large code and a button.
3. Type the code on the same screen. You land on **Nouveau mot de passe**.
4. Or request again and tap the button instead. It should open **Nouveau mot de passe** in any browser, even on another phone.

If the button still opens the landing page, the old template is still installed: its link has no `/auth/confirm`.
