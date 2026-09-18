"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionUser, getActiveProfile } from "./session";
import { canClaimInvitation, fetchStaffInvitation } from "./staff-invitations";
import { syncStaffRole } from "./staff-access";

export async function acceptStaffInvitation(token: string) {
  const path = "/invite/" + encodeURIComponent(token);
  const user = await getSessionUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(path));
  const result = await getActiveProfile();
  if (!result.profile || !user.email || !user.email_confirmed_at) redirect(path + "?error=account");
  const invite = await fetchStaffInvitation(token);
  if (!invite || !canClaimInvitation(invite, user.email)) redirect(path + "?error=invalid");
  const admin = createAdminClient();
  // The conditional write consumes the token once and preserves the assigned branch role.
  const { data, error } = await admin.from("restaurant_staff")
    .update({ profile_id: result.profile.id, status: "active", accepted_at: new Date().toISOString(), invite_token: null, invite_expires: null })
    .eq("id", invite.id).eq("status", "invited").eq("invite_token", token)
    .eq("invited_email", user.email.toLowerCase()).gt("invite_expires", new Date().toISOString())
    .select("id").maybeSingle();
  if (error || !data) redirect(path + "?error=invalid");
  await syncStaffRole({ id: result.profile.id, role: result.profile.role, status: result.profile.status, deleted_at: result.profile.deletedAt });
  revalidatePath("/", "layout");
  redirect("/m");
}
