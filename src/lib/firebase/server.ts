import "server-only";
import { createSign, createPrivateKey } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import type { PushPayload, PushDeviceResult } from "@/lib/push";

interface FirebaseServiceConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function config(): FirebaseServiceConfig | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey || privateKey.includes("REPLACE_ME")) return null;
  if (projectId !== "resto237-da372") return null;
  try { if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") return null; } catch { return null; }
  return { projectId, clientEmail, privateKey };
}

export function firebaseDeliveryConfigured(): boolean {
  return config() !== null;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

let accessToken: { value: string; expiresAt: number } | null = null;

async function firebaseAccessToken(current: FirebaseServiceConfig, forceRefresh = false): Promise<string> {
  if (!forceRefresh && accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({
      iss: current.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const assertion = `${signingInput}.${signer.sign(current.privateKey, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    signal: AbortSignal.timeout(10_000),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`OAuth token request failed (${response.status})`);
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("OAuth token response did not include an access token");
  accessToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return accessToken.value;
}

const FIREBASE_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

async function firebaseMessageRequest(
  current: FirebaseServiceConfig,
  initialBearer: string,
  token: string,
  payload: PushPayload,
  platform: "web" | "android" | "ios",
): Promise<Response> {
  let bearer = initialBearer;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(
        "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(current.projectId) + "/messages:send",
        {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
          body: JSON.stringify({ message: {
            token,
            data: { payload: JSON.stringify(payload) },
            ...(platform === "web"
              ? { webpush: { headers: { Urgency: "high", TTL: "86400" } } }
              : {
                  notification: { title: payload.title, body: payload.body ?? "" },
                  android: {
                    priority: "high",
                    notification: { channelId: "resto237_operational", tag: payload.tag },
                  },
                  apns: {
                    headers: { "apns-priority": "10" },
                    payload: { aps: { sound: "default", "content-available": 1 } },
                  },
                }),
          } }),
        },
      );
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }

    if (response.status === 401 && attempt === 0) {
      bearer = await firebaseAccessToken(current, true);
      continue;
    }
    if (FIREBASE_RETRY_STATUSES.has(response.status) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    return response;
  }
  throw new Error("Firebase retry limit reached");
}

export async function sendFirebasePush(
  profileId: string, payload: PushPayload, currentEndpoint?: string, nativeOnly = false,
): Promise<{ devices: PushDeviceResult[]; queryFailed?: boolean }> {
  const current = config();
  if (!current) return { devices: [], queryFailed: true };
  const supabase = createAdminClient();
  let { data, error } = await supabase.from("fcm_subscriptions")
    .select("id, token, web_endpoint, platform").eq("profile_id", profileId);
  if (error && ["42703", "PGRST204"].includes(error.code)) {
    // Keep browser delivery working while migration 0048 is being deployed.
    if (nativeOnly) return { devices: [] };
    const legacy = await supabase.from("fcm_subscriptions")
      .select("id, token, web_endpoint").eq("profile_id", profileId);
    data = legacy.data?.map((row) => ({ ...row, platform: "web" })) ?? null;
    error = legacy.error;
  }
  if (error) return { devices: [], queryFailed: true };
  const tokens = ((data ?? []) as {
    id: string;
    token: string;
    web_endpoint: string | null;
    platform: "web" | "android" | "ios" | null;
  }[]).filter((row) => !nativeOnly || row.platform === "android" || row.platform === "ios");
  if (!tokens.length) return { devices: [] };
  let bearer: string;
  try { bearer = await firebaseAccessToken(current); }
  catch { return { devices: tokens.map(t => ({ service: "Firebase", endpointTail: t.token.slice(-12), status: "failed", detail: "Firebase authentication failed" })) }; }
  const devices: PushDeviceResult[] = [];
  for (let start = 0; start < tokens.length; start += 10) {
    devices.push(...await Promise.all(tokens.slice(start, start + 10).map(async ({ id, token, web_endpoint, platform }): Promise<PushDeviceResult> => {
      const base = { service: "Firebase", endpointTail: token.slice(-12), isThisDevice: currentEndpoint ? web_endpoint === currentEndpoint || token === currentEndpoint : undefined };
      try {
        const response = await firebaseMessageRequest(current, bearer, token, payload, platform ?? "web");
        if (response.ok) return { ...base, status: "sent" };
        const body = await response.json().catch(() => ({})) as { error?: { details?: { errorCode?: string }[] } };
        const code = body.error?.details?.find(d => d.errorCode)?.errorCode;
        if (code === "UNREGISTERED") {
          await supabase.from("fcm_subscriptions").delete().eq("id", id).eq("token", token);
          return { ...base, status: "expired", code: response.status };
        }
        console.error("[firebase] delivery rejected", { status: response.status, code: code ?? "unknown", endpointTail: token.slice(-12) });
        return { ...base, status: "failed", code: response.status, detail: code ?? "Firebase rejected the message" };
      } catch (error) {
        console.error("[firebase] delivery request failed", { endpointTail: token.slice(-12), error: error instanceof Error ? error.message : "unknown" });
        return { ...base, status: "failed", detail: "Firebase request failed or timed out" };
      }
    })));
  }
  return { devices };
}
