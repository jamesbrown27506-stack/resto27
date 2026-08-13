"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import { NOTIFICATION_EVENTS } from "./settings";
import type { ActionResult } from "./admin-actions";

/**
 * Notification preferences, written.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  PER PERSON, PER BRANCH — and the person is the CALLER, never an argument.
 *
 *  `profile.id` comes from the session and `active.restaurantId` from the
 *  branch cookie validated against real staff membership. Accepting either
 *  from the client would turn "save my preferences" into "silence someone
 *  else's alerts", which is a Server Action's classic failure: it is a public
 *  POST endpoint that never passes through the page's guard.
 *
 *  LOCKED EVENTS ARE ENFORCED HERE. The disabled switch stops an accident;
 *  this stops a request. A restaurant cannot be talked out of hearing about a
 *  new order or an unpaid invoice by a crafted payload.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface NotificationPreferenceInput {
  key: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

export async function saveNotificationPreferences(
  prefs: NotificationPreferenceInput[],
): Promise<ActionResult> {
  const { active, profile } = await requireCapability("settings.manage");
  const supabase = createAdminClient();

  const posted = new Map(prefs.map((p) => [p.key, p]));

  // Iterating the CATALOGUE, not the payload: an unknown key never becomes a
  // row, and an event the client omitted is written at its default rather than
  // left to drift.
  const rows = NOTIFICATION_EVENTS.map((event) => {
    const sent = posted.get(event.key);
    return {
      restaurant_id: active.restaurantId,
      profile_id: profile.id,
      event_key: event.key,
      in_app: event.locked ? event.inApp : (sent ? sent.inApp === true : event.inApp),
      email: event.locked ? event.email : (sent ? sent.email === true : event.email),
      push: event.locked ? event.push : (sent ? sent.push === true : event.push),
    };
  });

  // upsert, because saving twice is the normal case: the second visit updates
  // the rows the first one created.
  const { error } = await supabase
    .from("notification_preferences")
    .upsert(rows, { onConflict: "restaurant_id,profile_id,event_key" });

  if (error) {
    console.error("[settings:saveNotificationPreferences]", error.message);
    return { ok: false, error: "Could not save your notification preferences." };
  }

  revalidatePath("/m/settings");
  return { ok: true };
}
