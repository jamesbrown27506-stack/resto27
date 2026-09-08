import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { appMode } from "./site-url";

/**
 * Outbound email, over SMTP.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY SMTP AND NOT A PROVIDER'S HTTP API.
 *
 *  Supabase sends its OWN emails — password reset, email confirmation, magic
 *  link, invitations — from inside Supabase, and the only way to control that
 *  is its Custom SMTP settings. It is not a mail API we can call: nothing in
 *  this codebase can ask Supabase to send "your restaurant was approved".
 *
 *  So there are two senders no matter what. Speaking SMTP here means BOTH can
 *  be pointed at the SAME provider with the SAME credentials — one verified
 *  domain, one reputation, one place to look when a message goes missing.
 *  An HTTP API would have worked equally well for our half and left the two
 *  halves permanently unrelated.
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  WHEN NO PROVIDER IS CONFIGURED, THIS DOES NOT SILENTLY SUCCEED.
 *
 *  It returns `{ sent: false, reason }` and logs the message it would have
 *  sent. Callers surface that rather than reporting success — a "reply sent"
 *  toast for an email nobody received is the failure mode this is written to
 *  avoid.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. Kept deliberately simple — no templating layer yet. */
  body: string;
  replyTo?: string;
}

export interface MailResult {
  sent: boolean;
  reason?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

function missing(name: string, value: string | undefined): boolean {
  return !value || value.trim() === "" || value.includes("REPLACE_ME");
}

function config(): { ok: true; smtp: SmtpConfig } | { ok: false; reason: string } {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.MAIL_FROM;

  for (const [name, value] of [
    ["SMTP_HOST", host],
    ["SMTP_USER", user],
    ["SMTP_PASSWORD", pass],
    ["MAIL_FROM", from],
  ] as const) {
    if (missing(name, value)) {
      return { ok: false, reason: `${name} is not set in .env.local.` };
    }
  }

  const port = Number(process.env.SMTP_PORT ?? 587);

  /**
   * GMAIL REWRITES THE FROM HEADER. This is the classic Gmail SMTP surprise.
   *
   * Google will not let you send as an address you have not proven you own, so
   * a `MAIL_FROM` of noreply@yourbrand.cm is either rejected or silently
   * replaced with the account address — and every reply then goes somewhere
   * nobody reads. Caught here, before the send, because the symptom otherwise
   * appears in the recipient's inbox rather than in any log of ours.
   *
   * A display name is fine: "Resto237 <you@gmail.com>" works.
   */
  if (host!.includes("gmail") || host!.includes("googlemail")) {
    const address = from!.match(/<([^>]+)>/)?.[1] ?? from!;
    if (address.trim().toLowerCase() !== user!.trim().toLowerCase()) {
      return {
        ok: false,
        reason: `Gmail only sends as the account itself. MAIL_FROM must use ${user} — a display name like "Resto237 <${user}>" is fine.`,
      };
    }
  }

  return {
    ok: true,
    smtp: {
      host: host!,
      port,
      user: user!,
      pass: pass!,
      from: from!,
      /**
       * 465 is implicit TLS; 587 and 2525 start plaintext and upgrade with
       * STARTTLS, which nodemailer does automatically when `secure` is false.
       * Deriving this from the port rather than asking for it removes the
       * single most common SMTP misconfiguration — `secure: true` on 587
       * hangs until it times out, with no useful error.
       */
      secure: port === 465,
    },
  };
}

/** True when email can actually be delivered. Drives UI copy. */
export function mailIsConfigured(): boolean {
  return config().ok;
}

/** Why it is not configured, for the diagnostics page. Null when it is. */
export function mailConfigProblem(): string | null {
  const settings = config();
  return settings.ok ? null : settings.reason;
}

/**
 * One transporter, reused.
 *
 * `pool: true` keeps the connection open between sends instead of paying a
 * TLS handshake per email — which matters the moment a broadcast goes out.
 * Cached on globalThis so Next's dev-mode module reloading does not leak a new
 * pool on every edit.
 */
const globalForMail = globalThis as unknown as { __restolinkMailer?: Transporter };

function transporter(smtp: SmtpConfig): Transporter {
  globalForMail.__restolinkMailer ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    pool: true,
    maxConnections: 3,
    // A hung SMTP connection must not hold a Server Action open indefinitely;
    // the caller treats a timeout as "not sent" and says so.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return globalForMail.__restolinkMailer;
}

/**
 * In TEST mode, every message is diverted to one inbox.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS IS THE POINT OF TEST MODE.
 *
 *  Development databases get seeded from production, or filled with addresses
 *  belonging to real people who signed up early. Approving a restaurant while
 *  testing then emails an actual restaurateur that they are live when they are
 *  not. Once sent, an email cannot be recalled.
 *
 *  So test mode does not merely change the links — it makes reaching a real
 *  customer IMPOSSIBLE. The intended recipient is preserved in the subject, so
 *  the diverted copy is still readable as what it was.
 *
 *  Live mode does none of this. If MAIL_TEST_INBOX is left set when you go
 *  live, it is ignored rather than silently swallowing customer mail.
 * ─────────────────────────────────────────────────────────────────────────
 */
function divert(message: MailMessage): { message: MailMessage; diverted: string | null } {
  if (appMode() !== "test") return { message, diverted: null };

  const inbox = process.env.MAIL_TEST_INBOX?.trim();
  if (!inbox || inbox.includes("REPLACE_ME") || inbox === message.to) {
    return { message, diverted: null };
  }

  return {
    message: {
      ...message,
      to: inbox,
      subject: `[TEST → ${message.to}] ${message.subject}`,
      body: `--- TEST MODE ---\nThis was addressed to: ${message.to}\nIt was diverted to you because APP_MODE=test.\n-----------------\n\n${message.body}`,
    },
    diverted: message.to,
  };
}

export async function sendMail(input: MailMessage): Promise<MailResult> {
  const { message, diverted } = divert(input);
  const settings = config();

  if (!settings.ok) {
    // Log the full message so nothing is lost while the provider is pending.
    console.warn(
      `[mail] NOT SENT (${settings.reason})\n  to: ${message.to}\n  subject: ${message.subject}\n  ${message.body.replace(/\n/g, "\n  ")}`,
    );
    return { sent: false, reason: settings.reason };
  }

  try {
    await transporter(settings.smtp).sendMail({
      from: settings.smtp.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });

    if (diverted) {
      console.info(`[mail] TEST MODE — diverted ${diverted} → ${message.to}`);
    }

    return { sent: true };
  } catch (error) {
    /**
     * The real error goes to the log; the caller gets something a person can
     * act on. SMTP failures are unusually diagnosable, so the common ones are
     * named rather than flattened into "could not send".
     */
    console.error("[mail] SMTP send failed", error);

    const detail = error instanceof Error ? error.message : String(error);
    const lower = detail.toLowerCase();

    if (lower.includes("invalid login") || lower.includes("authentication")) {
      return { sent: false, reason: "SMTP rejected the credentials — check SMTP_USER and SMTP_PASSWORD." };
    }
    if (lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("enotfound")) {
      return { sent: false, reason: `Could not reach ${settings.smtp.host}:${settings.smtp.port}.` };
    }
    if (lower.includes("sender") || lower.includes("from address") || lower.includes("not verified")) {
      return { sent: false, reason: "The sender address was refused — is MAIL_FROM's domain verified?" };
    }

    return { sent: false, reason: "The mail server refused the message." };
  }
}

/**
 * Send without letting a mail failure break the operation.
 *
 * Same principle as the audit writer (§9): approving a restaurant must succeed
 * even when the mail provider is down. The caller finds out whether the email
 * went, and decides how to word the result.
 */
export async function trySendMail(message: MailMessage): Promise<MailResult> {
  try {
    return await sendMail(message);
  } catch (error) {
    console.error("[mail] unexpected", error);
    return { sent: false, reason: "Unexpected mail error." };
  }
}

/**
 * Prove the settings work, without sending to a real customer.
 *
 * Used by /a/tests. `verify()` opens the connection and authenticates but
 * sends nothing — which is exactly the check you want before trusting the
 * configuration, and the one that catches a wrong port or a stale password.
 */
export async function verifyMailConnection(): Promise<MailResult> {
  const settings = config();
  if (!settings.ok) return { sent: false, reason: settings.reason };

  try {
    await transporter(settings.smtp).verify();
    return { sent: true };
  } catch (error) {
    console.error("[mail] verify failed", error);
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "SMTP verification failed.",
    };
  }
}
