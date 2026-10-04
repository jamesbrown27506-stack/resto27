"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { superAdminOrError } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";

/**
 * "Reset the platform to new" (0067) — super admins only.
 *
 * Wipes every trace of test activity (orders, payments, notifications,
 * chats, bookings, reviews, wallets…) and keeps users, restaurants, menus
 * and settings. Irreversible: the caller must type RESET, and the database
 * function refuses anything else too. The audit log is kept and records who
 * did it and what was removed.
 */

export async function getActivityCounts(): Promise<
  { ok: true; counts: Record<string, number> } | { ok: false; error: string }
> {
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  const { data, error } = await createAdminClient().rpc("platform_activity_counts");
  if (error) {
    return {
      ok: false,
      error:
        error.code === "42883" || error.code === "PGRST202"
          ? "Run migration 0067 in the Supabase SQL editor first."
          : error.message,
    };
  }
  return { ok: true, counts: (data ?? {}) as Record<string, number> };
}

export async function resetPlatformActivity(
  confirmation: string,
): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  const gate = await superAdminOrError();
  if (!gate.ok) return gate;
  if (confirmation.trim() !== "RESET") return { ok: false, error: "Type RESET to confirm." };

  const { data, error } = await createAdminClient().rpc("platform_reset_activity", { p_confirm: "RESET" });
  if (error) {
    console.error("[platform:reset]", error.code, error.message);
    return {
      ok: false,
      error:
        error.code === "42883" || error.code === "PGRST202"
          ? "Run migration 0067 in the Supabase SQL editor first."
          : `Reset failed, nothing was changed: ${error.message}`,
    };
  }

  const wiped = ((data as { wiped?: Record<string, number> } | null)?.wiped ?? {}) as Record<string, number>;
  await writeAudit(gate.admin, {
    action: "platform.reset_activity",
    entityType: "platform",
    summary: `Test activity wiped: ${Object.entries(wiped)
      .map(([table, count]) => `${table} ${count}`)
      .join(", ")}`,
    metadata: wiped,
  });

  revalidatePath("/", "layout");
  return { ok: true, note: "The platform is clean: activity wiped, users, restaurants and menus kept." };
}
