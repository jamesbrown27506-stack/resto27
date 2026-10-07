import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import type { AuthProfile } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { trySendMail } from "@/lib/mail";
import { absoluteUrl } from "@/lib/site-url";
import type { BranchTeamAssignment } from "./team-rules";
import type { BranchLeader, BranchTeamMember } from "./team-types";

/** Only accepted, active colleagues in the owner's group may be copied directly. */
export async function loadBranchTeam(locationIds: string[]): Promise<{ available: boolean; members: BranchTeamMember[] }> {
  const { data, error } = await createAdminClient().from("restaurant_staff")
    .select("profile_id, profiles!restaurant_staff_profile_id_fkey!inner (id, name, email, status, deleted_at)")
    .in("restaurant_id", locationIds).eq("status", "active")
    .eq("profiles.status", "active").is("profiles.deleted_at", null);
  if (error) {
    console.error("[branches:team]", error.code);
    return { available: false, members: [] };
  }
  const members = new Map<string, BranchTeamMember>();
  for (const row of (data ?? []) as unknown as { profile_id: string | null; profiles: { id: string; name: string; email: string; status: string; deleted_at: string | null } | null }[]) {
    const person = row.profiles;
    if (!row.profile_id || !person || person.status !== "active" || person.deleted_at) continue;
    members.set(row.profile_id, { profileId: row.profile_id, name: person.name || person.email, email: person.email });
  }
  return { available: true, members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function loadBranchLeaders(locationIds: string[]): Promise<Record<string, BranchLeader[]>> {
  const { data, error } = await createAdminClient().from("restaurant_staff")
    .select("restaurant_id, role, status, display_name, invited_email, invite_expires, profiles!restaurant_staff_profile_id_fkey (name, email, status, deleted_at)")
    .in("restaurant_id", locationIds).in("role", ["owner", "manager"]).in("status", ["active", "invited"]);
  if (error) { console.error("[branches:leaders]", error.code); return {}; }
  const result: Record<string, BranchLeader[]> = {};
  type Row = { restaurant_id: string; role: "owner" | "manager"; status: string; display_name: string | null; invited_email: string | null; invite_expires: string | null; profiles: { name: string; email: string; status: string; deleted_at: string | null } | null };
  for (const row of (data ?? []) as unknown as Row[]) {
    const invited = row.status === "invited";
    if (invited && (!row.invite_expires || Date.parse(row.invite_expires) <= Date.now())) continue;
    if (!invited && (!row.profiles || row.profiles.status !== "active" || row.profiles.deleted_at)) continue;
    const name = row.profiles?.name || row.display_name || row.invited_email;
    if (name) (result[row.restaurant_id] ??= []).push({ name, role: row.role, invited });
  }
  return result;
}

/** Called only for a newly created, unpublished branch by the owner action. */
export async function installBranchTeam(branchId: string, assignments: BranchTeamAssignment[], actor: AuthProfile) {
  const now = new Date().toISOString();
  const invitations = assignments.filter(person => !person.profileId).map(person => ({ ...person, token: randomUUID() }));
  if (assignments.length === 0) return { ok: true as const, invitations };
  const rows = assignments.map(person => ({
    restaurant_id: branchId,
    profile_id: person.profileId,
    role: person.role,
    status: person.profileId ? "active" : "invited",
    invited_email: person.email,
    display_name: person.name,
    invited_by: actor.id,
    invited_at: now,
    accepted_at: person.profileId ? now : null,
    invite_token: invitations.find(invite => invite.email === person.email)?.token ?? null,
    invite_expires: person.profileId ? null : new Date(Date.now() + 7 * 86_400_000).toISOString(),
  }));
  // One statement: either every selected role is installed, or none is.
  const { error } = await createAdminClient().from("restaurant_staff").insert(rows);
  if (error) { console.error("[branches:installTeam]", error.code); return { ok: false as const, invitations: [] }; }
  return { ok: true as const, invitations };
}

export async function announceBranchTeam(input: {
  branchId: string;
  label: string;
  restaurantName: string;
  actor: AuthProfile;
  assignments: BranchTeamAssignment[];
  invitations: (BranchTeamAssignment & { token: string })[];
}): Promise<boolean> {
  for (const person of input.assignments) {
    await writeAudit(input.actor, {
      action: person.profileId ? "staff.added_to_branch" : "staff.invited",
      entityType: "restaurant_staff", entityId: input.branchId,
      summary: `${person.email} ${person.profileId ? "assigned" : "invited"} as ${person.role} at ${input.restaurantName} — ${input.label}`,
      metadata: { profileId: person.profileId, role: person.role },
    });
  }
  let allSent = true;
  for (const invitation of input.invitations) {
    const mail = await trySendMail({
      to: invitation.email,
      subject: `Rejoignez ${input.restaurantName} — ${input.label} sur Resto237`,
      body: `${input.actor.name} vous invite à rejoindre ${input.restaurantName}, succursale ${input.label}, comme ${invitation.role === "owner" ? "copropriétaire" : "gérant"}.\n\nConnectez-vous ou créez un compte avec cette adresse (${invitation.email}), vérifiez votre e-mail, puis acceptez l'invitation. Votre accès commence après votre acceptation.`,
      action: { label: "Voir mon invitation", url: await absoluteUrl(`/invite/${invitation.token}`) },
      locale: "fr",
    });
    if (!mail.sent) allSent = false;
  }
  return allSent;
}
