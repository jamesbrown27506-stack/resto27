import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionUser } from "./session";
import { hasVerifiedMailbox } from "./security-rules";

export function validInviteToken(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}
export function canClaimInvitation(invite: { status: string; invited_email: string | null; invite_expires: string | null }, email: string, now = Date.now()): boolean {
  return invite.status === "invited" && !!invite.invited_email && !!invite.invite_expires
    && Date.parse(invite.invite_expires) > now
    && invite.invited_email.trim().toLowerCase() === email.trim().toLowerCase();
}
export async function fetchStaffInvitation(token: string) {
  if (!validInviteToken(token)) return null;
  const { data, error } = await createAdminClient().from("restaurant_staff")
    .select("id, role, status, invited_email, invite_expires, restaurants(name, branch_label)")
    .eq("invite_token", token).eq("status", "invited").maybeSingle();
  if (error) throw new Error("Could not load the staff invitation.");
  if (!data || !data.invite_expires || Date.parse(data.invite_expires) <= Date.now()) return null;
  return data;
}
export async function fetchMyStaffInvitations() {
  const user = await getSessionUser();
  if (!user?.email || !hasVerifiedMailbox(user)) return [];
  const { data, error } = await createAdminClient().from("restaurant_staff")
    .select("id, invite_token, restaurants(name)")
    .eq("invited_email", user.email.toLowerCase()).eq("status", "invited")
    .gt("invite_expires", new Date().toISOString());
  if (error) throw new Error("Could not load restaurant invitations.");
  return data ?? [];
}
