"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { firebaseDeliveryConfigured } from "@/lib/firebase/server";
import { notificationProvider, type NotificationProvider } from "@/lib/notification-provider";
import { sendPushWithReport, pushConfigured } from "@/lib/push";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "./platform-actions";

export async function getNotificationProviderStatus() {
  await requireRole("admin");
  const db = createAdminClient();
  const [firebase, web] = await Promise.all([
    db.from("fcm_subscriptions").select("id, device_id, web_endpoint", { count: "exact" }).limit(1),
    db.from("push_subscriptions").select("id", { count: "exact", head: true }),
  ]);
  return { provider: await notificationProvider(), firebaseConfigured: firebaseDeliveryConfigured(),
    webConfigured: pushConfigured(), storageReady: !firebase.error,
    firebaseDevices: firebase.count ?? 0, webDevices: web.count ?? 0 };
}

export async function setNotificationProvider(provider: NotificationProvider) {
  const admin = await requireRole("admin");
  if (provider !== "firebase" && provider !== "web_push") return { ok: false, error: "Invalid provider." };
  const status = await getNotificationProviderStatus();
  if (provider === "firebase" && (!status.firebaseConfigured || !status.storageReady || !status.firebaseDevices)) {
    return { ok: false, error: "Firebase needs server credentials, database migration 0045, and at least one registered device before activation." };
  }
  const { error } = await createAdminClient().from("settings").upsert({
    key: "push_provider", value: provider, value_type: "string", category: "notifications",
    label: "Push delivery provider", description: "Provider used for all operational push notifications.",
  }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save the notification provider." };
  await writeAudit(admin, { action: "settings.update", entityType: "settings", summary: "Changed push delivery provider", metadata: { provider } });
  revalidatePath("/a/settings");
  return { ok: true };
}

export async function testNotificationProvider(provider: NotificationProvider) {
  const admin = await requireRole("admin");
  if (provider !== "web_push" && provider !== "firebase") return { ok: false, message: "Invalid provider." };
  const limit = await rateLimit({ key: "push:compare", identifier: admin.id, limit: 6, windowMs: 60_000 });
  if (!limit.ok) return { ok: false, message: "Please wait a minute before another test." };
  const report = await sendPushWithReport(admin.id, {
    title: provider === "firebase" ? "Resto237 — Firebase test" : "Resto237 — Web Push test",
    body: "Notification provider comparison", href: "/a/settings", tag: "provider-test-" + provider,
  }, undefined, provider);
  const sent = report.devices.filter(d => d.status === "sent").length;
  const message = !report.configured ? "Server credentials are missing."
    : !report.platformEnabled ? "Platform push notifications are disabled."
    : report.queryFailed ? "Device storage is unavailable. Apply the database migration."
    : !report.devices.length ? "No devices registered for your administrator account. Enable notifications on this device first."
    : sent ? `Accepted by ${provider === "firebase" ? "Firebase" : "Web Push"} for ${sent} device(s). Check your device to confirm receipt.`
    : "Delivery failed: " + report.devices.map(d => d.detail ?? d.status).join("; ");
  return { ok: sent > 0, message };
}
