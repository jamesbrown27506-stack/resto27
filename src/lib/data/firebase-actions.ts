"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { requireUser, getCurrentProfile } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

const COOKIE = "resto237_push_device";

export async function saveFirebaseToken(
  token: string,
  webEndpoint?: string,
  native?: { platform: "android" | "ios"; appVersion?: string },
) {
  const profile = await requireUser();
  if (native && (!['android', 'ios'].includes(native.platform) ||
      (native.appVersion !== undefined && typeof native.appVersion !== 'string'))) {
    return { ok: false, error: "Invalid native device." };
  }
  if (typeof token !== "string" || token.length < 20 || token.length > 4096 || /\s/.test(token)) {
    return { ok: false, error: "Invalid Firebase registration." };
  }
  if (webEndpoint && (typeof webEndpoint !== "string" || webEndpoint.length > 4096 || !webEndpoint.startsWith("https://"))) {
    return { ok: false, error: "Invalid browser endpoint." };
  }
  const limit = await rateLimit({ key: "fcm:register", identifier: profile.id, limit: 30, windowMs: 60_000 });
  if (!limit.ok) return { ok: false, error: "Please try again shortly." };
  const jar = await cookies();
  let deviceId = jar.get(COOKIE)?.value;
  if (!deviceId || !/^[0-9a-f-]{36}$/i.test(deviceId)) deviceId = randomUUID();
  jar.set(COOKIE, deviceId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  const db = createAdminClient();
  // Possession of a token binds this browser to its current signed-in account.
  // Remove its previous token on rotation, and transfer an existing token on login.
  const removed = await db.from("fcm_subscriptions").delete().eq("device_id", deviceId).neq("token", token);
  if (removed.error) return { ok: false, error: "Firebase device storage is not ready. Contact the administrator." };
  const row = {
    token, device_id: deviceId, profile_id: profile.id, web_endpoint: webEndpoint ?? null,
    user_agent: (await headers()).get("user-agent")?.slice(0, 512) ?? null,
    updated_at: new Date().toISOString(),
  };
  let { error } = await db.from("fcm_subscriptions").upsert({
    ...row, platform: native?.platform ?? "web", app_version: native?.appVersion?.slice(0, 64) ?? null,
  }, { onConflict: "token" });
  if (!native && error && ['42703', 'PGRST204'].includes(error.code)) {
    ({ error } = await db.from("fcm_subscriptions").upsert(row, { onConflict: "token" }));
  }
  if (error) return { ok: false, error: "Could not save this Firebase device. Please try again." };
  const { data: surplus } = await db.from("fcm_subscriptions").select("id").eq("profile_id", profile.id)
    .order("updated_at", { ascending: false }).range(10, 1000);
  if (surplus?.length) await db.from("fcm_subscriptions").delete().in("id", surplus.map(row => row.id));
  return { ok: true };
}

export async function removeFirebaseDevice() {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: true, remaining: 0 };
  const id = (await cookies()).get(COOKIE)?.value;
  const db = createAdminClient();
  if (id) {
    const { error } = await db.from("fcm_subscriptions").delete()
      .eq("device_id", id).eq("profile_id", profile.id);
    if (error && !["PGRST205", "42P01"].includes(error.code)) return { ok: false, remaining: 0, error: "Could not disconnect Firebase on this device." };
  }
  const [count, browsers] = await Promise.all([
    db.from("fcm_subscriptions").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
    db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("profile_id", profile.id),
  ]);
  const missingFcmTable = count.error && ["PGRST205", "42P01"].includes(count.error.code);
  if ((count.error && !missingFcmTable) || browsers.error || (!missingFcmTable && count.count === null) || browsers.count === null) {
    return { ok: false, error: "Device removed, but remaining devices could not be checked. Please retry." };
  }
  return { ok: true, remaining: (count.count ?? 0) + browsers.count };
}
