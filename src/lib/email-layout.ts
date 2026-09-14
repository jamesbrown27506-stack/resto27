/**
 * The branded HTML every outgoing email is wrapped in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ONE LAYOUT, WRITTEN FROM THE PLAIN TEXT CALLERS ALREADY PRODUCE.
 *
 *  Every sender in the app builds a plain-text body — notifications, staff
 *  invitations, approvals, support replies. Rather than give each one a
 *  template, lib/mail renders THAT text into this layout: paragraphs stay
 *  paragraphs, a sign-off line ("— Resto237") becomes a quiet signature, a
 *  bare URL becomes a link, and a caller that names an `action` gets a real
 *  button. The plain text still goes out alongside, for clients that want it.
 *
 *  Email HTML is its own world: tables, inline styles, no stylesheet, no
 *  web fonts, no dark-mode guessing. Every rule below is there for Gmail,
 *  Outlook or Apple Mail, not for taste.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pure — no server-only imports — so it is tested directly.
 */

export interface EmailBrand {
  name: string;
  tagline: string;
  /** Absolute URL of the logo; null falls back to the app icon on the site. */
  logoUrl: string | null;
  /** Canonical site, absolute, no trailing slash. */
  siteUrl: string;
  supportEmail: string;
}

export interface EmailContent {
  subject: string;
  /** The same plain text the text part carries. */
  body: string;
  /** A button. Its URL is dropped from the paragraphs, where it would repeat. */
  action?: { label: string; url: string };
  /** Inbox preview line; defaults to the first paragraph. */
  preheader?: string;
  locale?: "fr" | "en";
  /** A warning strip above the card — test-mode diversion. */
  notice?: string;
}

// The app's own palette (globals.css, light theme).
const C = {
  page: "#F7F4ED",
  card: "#FFFFFF",
  ink: "#1C1C1C",
  muted: "#5A5A52",
  faint: "#8A8478",
  line: "#E4DDD0",
  primary: "#5F7257",
  noticeBg: "#FDF3E1",
  noticeInk: "#8A5A12",
};

const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Links bare URLs in already-escaped text. */
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:${C.primary};text-decoration:underline;word-break:break-all;">${url}</a>`,
  );
}

const COPY = {
  fr: {
    fallback: "Le bouton ne s’ouvre pas ? Copiez ce lien dans votre navigateur :",
    why: "Vous recevez cet email parce que vous avez un compte ou une commande sur",
    help: "Une question ? Écrivez-nous à",
  },
  en: {
    fallback: "Button not working? Copy this link into your browser:",
    why: "You are receiving this email because you have an account or an order on",
    help: "A question? Write to us at",
  },
};

export function renderEmailHtml(content: EmailContent, brand: EmailBrand): string {
  const locale = content.locale ?? "fr";
  const copy = COPY[locale];
  const actionUrl = content.action?.url.trim();

  // Paragraphs, minus the lines that repeat the button's URL.
  const paragraphs = content.body
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter((line) => !(actionUrl && line.trim() === actionUrl))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);

  // Notification emails open with their own title — it is the heading here.
  if (paragraphs[0] === content.subject.trim()) paragraphs.shift();

  // "— Resto237" style sign-offs close the card quietly instead of as body text.
  const signature = paragraphs.length > 1 && /^[—–-]\s/.test(paragraphs[paragraphs.length - 1]!)
    ? paragraphs.pop()!
    : null;

  const preheader = content.preheader ?? paragraphs[0] ?? content.subject;
  const logo = brand.logoUrl ?? `${brand.siteUrl}/app-icon-192.png`;

  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.ink};">${linkify(
          escapeHtml(p),
        ).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const button = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
        <tr><td bgcolor="${C.primary}" style="border-radius:10px;">
          <a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:15px;font-weight:700;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(content.action.label)}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 16px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.faint};">${copy.fallback}<br><a href="${escapeHtml(content.action.url)}" style="color:${C.primary};word-break:break-all;">${escapeHtml(content.action.url)}</a></p>`
    : "";

  const notice = content.notice
    ? `<tr><td style="padding:0 0 12px;">
        <div style="padding:10px 14px;border-radius:10px;background:${C.noticeBg};font-family:${SANS};font-size:12px;line-height:1.5;color:${C.noticeInk};">${escapeHtml(content.notice)}</div>
      </td></tr>`
    : "";

  const host = brand.siteUrl.replace(/^https?:\/\//, "");

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding-right:10px;"><img src="${escapeHtml(logo)}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></td>
          <td style="font-family:${SERIF};font-size:20px;font-weight:700;color:${C.ink};">${escapeHtml(brand.name)}</td>
        </tr></table>
      </td></tr>
      ${notice}
      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;padding:32px 28px 16px;">
        <h1 style="margin:0 0 18px;font-family:${SERIF};font-size:22px;line-height:1.3;font-weight:700;color:${C.ink};">${escapeHtml(content.subject)}</h1>
        ${body}
        ${button}
        ${signature ? `<p style="margin:4px 0 16px;font-family:${SANS};font-size:14px;line-height:1.5;color:${C.muted};">${escapeHtml(signature)}</p>` : ""}
      </td></tr>
      <tr><td align="center" style="padding:20px 16px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.faint};">
        <strong style="color:${C.muted};">${escapeHtml(brand.name)}</strong> · ${escapeHtml(brand.tagline)}<br>
        ${copy.help} <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${C.primary};">${escapeHtml(brand.supportEmail)}</a><br>
        ${copy.why} <a href="${escapeHtml(brand.siteUrl)}" style="color:${C.primary};">${escapeHtml(host)}</a>.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
