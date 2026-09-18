import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/** A platform role alone grants no branch permissions; active membership does. */
export async function syncStaffRole(profile: { id: string; role: string; status: string; deleted_at: string | null }): Promise<string> {
  if (profile.role !== "customer" || profile.status !== "active" || profile.deleted_at) return profile.role;
  const admin = createAdminClient();
  const { data, error } = await admin.from("restaurant_staff").select("id")
    .eq("profile_id", profile.id).eq("status", "active").limit(1);
  if (error) throw new Error("Could not verify restaurant membership.");
  if (!data?.length) return profile.role;
  const { data: promoted, error: updateError } = await admin.from("profiles").update({ role: "manager" })
    .eq("id", profile.id).eq("role", "customer").eq("status", "active").is("deleted_at", null).select("role").maybeSingle();
  if (updateError) throw new Error("Could not enable restaurant access.");
  return promoted?.role ?? profile.role;
}
