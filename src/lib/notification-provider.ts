import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export type NotificationProvider = "web_push" | "firebase";

export async function notificationProvider(): Promise<NotificationProvider> {

  try {
    const { data, error } = await createAdminClient().from("settings").select("value").eq("key", "push_provider").maybeSingle();
    if (error) throw error;
    const value: NotificationProvider = data?.value === "firebase" ? "firebase" : "web_push";

    return value;
  } catch (error) {
    console.error("[notifications] could not read delivery provider; using Web Push", error);
    return "web_push";
  }
}
