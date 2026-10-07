/** Shared form data; no server dependencies or credentials. */
export type BranchTeamChoice =
  | { kind: "none" }
  | { kind: "member"; profileId: string }
  | { kind: "invite"; email: string };

export interface BranchTeamMember {
  profileId: string;
  name: string;
  email: string;
}

export interface BranchLeader {
  name: string;
  role: "owner" | "manager";
  invited: boolean;
}
