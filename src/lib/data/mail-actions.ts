"use server";

import { requireRole } from "@/lib/auth/session";
import { sendMail, verifyMailConnection } from "@/lib/mail";
import { writeAudit } from "./platform-actions";

/**
 * The two email checks behind /a/tests.
 *
 * Admin-only, like every action in the admin area — a Server Action is a POST
 * endpoint that never passes through the layout guarding its page. An open
 * "send an email" endpoint is an open relay with extra steps.
 */

export interface MailTestResult {
  ok: boolean;
  message: string;
}

/**
 * Open the connection and authenticate. Sends nothing.
 *
 * This is the check worth running first: it separates "the credentials are
 * wrong" from "the message was refused", which look identical from the outside
 * and have completely different fixes.
 */
export async function testMailConnection(): Promise<MailTestResult> {
  await requireRole("admin");

  const result = await verifyMailConnection();

  return result.sent
    ? { ok: true, message: `Connected and authenticated as ${process.env.SMTP_USER}.` }
    : { ok: false, message: result.reason ?? "Could not connect." };
}

/**
 * Send one real email, to the signed-in admin's own address.
 *
 * Deliberately not parameterised. A test that accepts a recipient is a test
 * that eventually gets pointed at a customer — or found by someone who should
 * not have it. The address comes from the session, so the worst case is an
 * admin emailing themselves.
 */
export async function sendTestEmail(): Promise<MailTestResult> {
  const admin = await requireRole("admin");

  const result = await sendMail({
    to: admin.email,
    subject: "RestoLink — test email",
    body: [
      `Hello ${admin.name.split(" ")[0]},`,
      "",
      "If you are reading this, outbound email works.",
      "",
      `Sent from: ${process.env.MAIL_FROM}`,
      `Server:    ${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 587}`,
      "",
      "Nothing else was sent, and no customer received a copy.",
    ].join("\n"),
  });

  // Audited: it is a real outbound message, and "who sent mail from this
  // system, when" is exactly what the trail exists to answer (§9).
  await writeAudit(admin, {
    action: "mail.test",
    entityType: "settings",
    summary: result.sent ? `Test email sent to ${admin.email}` : `Test email failed: ${result.reason}`,
  });

  return result.sent
    ? {
        ok: true,
        message: `Sent to ${admin.email}. If it does not arrive within a minute, check the spam folder — that is normal for a new sender.`,
      }
    : { ok: false, message: result.reason ?? "Send failed." };
}
