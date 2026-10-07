import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { BranchTeamChoice, BranchTeamMember } from "./team-types";

export interface BranchTeamAssignment {
  profileId: string | null;
  name: string | null;
  email: string;
  role: "owner" | "manager";
}

/** The caller supplies a freshly read, accepted roster of this restaurant group. */
export function resolveBranchTeam(input: {
  members: BranchTeamMember[];
  mainOwnerId: string;
  actorOwnerId: string | null;
  manager?: BranchTeamChoice;
  coOwner?: BranchTeamChoice;
}): { ok: true; assignments: BranchTeamAssignment[] } | { ok: false; errorKey: TranslationKey } {
  const assignments: BranchTeamAssignment[] = [];
  const primaryOwner = input.members.find(member => member.profileId === input.mainOwnerId);
  if (!primaryOwner) return { ok: false, errorKey: "mbr.err.ownerUnavailable" };

  // A main restaurant co-owner creating a location keeps access there too.
  // Impersonating administrators pass null and never acquire tenant membership.
  if (input.actorOwnerId && input.actorOwnerId !== input.mainOwnerId) {
    const actor = input.members.find(member => member.profileId === input.actorOwnerId);
    if (!actor) return { ok: false, errorKey: "mbr.err.teamMember" };
    assignments.push({ ...actor, role: "owner" });
  }

  for (const [role, choice] of [["owner", input.coOwner], ["manager", input.manager]] as const) {
    if (choice === undefined || choice?.kind === "none") continue;
    if (!choice || typeof choice !== "object") return { ok: false, errorKey: "mbr.err.teamChoice" };
    let assignment: BranchTeamAssignment;
    if (choice.kind === "member" && typeof choice.profileId === "string") {
      const member = input.members.find(person => person.profileId === choice.profileId);
      if (!member) return { ok: false, errorKey: "mbr.err.teamMember" };
      if (member.profileId === input.mainOwnerId || (role === "manager" && member.profileId === input.actorOwnerId)) {
        return { ok: false, errorKey: "mbr.err.teamDuplicate" };
      }
      if (role === "owner" && member.profileId === input.actorOwnerId) continue;
      assignment = { ...member, role };
    } else if (choice.kind === "invite" && typeof choice.email === "string") {
      const email = choice.email.trim().toLowerCase();
      if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errorKey: "est.emailInvalid" };
      if (input.members.some(member => member.email.toLowerCase() === email)) return { ok: false, errorKey: "mbr.err.teamExistingEmail" };
      assignment = { profileId: null, name: null, email, role };
    } else {
      return { ok: false, errorKey: "mbr.err.teamChoice" };
    }
    if (assignments.some(person => person.email.toLowerCase() === assignment.email.toLowerCase() || (assignment.profileId && person.profileId === assignment.profileId))) {
      return { ok: false, errorKey: "mbr.err.teamDuplicate" };
    }
    assignments.push(assignment);
  }
  return { ok: true, assignments };
}
