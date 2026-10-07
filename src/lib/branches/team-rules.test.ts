import { describe, expect, it } from "vitest";
import { resolveBranchTeam } from "./team-rules";

const members = [
  { profileId: "owner", name: "Owner", email: "owner@example.com" },
  { profileId: "marie", name: "Marie", email: "marie@example.com" },
  { profileId: "paul", name: "Paul", email: "paul@example.com" },
];
const base = { members, mainOwnerId: "owner", actorOwnerId: "owner" };

describe("branch leadership choices", () => {
  it("keeps the automatically seeded main owner without duplicate membership", () => {
    expect(resolveBranchTeam(base)).toEqual({ ok: true, assignments: [] });
  });
  it("assigns accepted colleagues different roles at this branch", () => {
    expect(resolveBranchTeam({ ...base, manager: { kind: "member", profileId: "marie" }, coOwner: { kind: "member", profileId: "paul" } })).toMatchObject({
      ok: true, assignments: [{ profileId: "paul", role: "owner" }, { profileId: "marie", role: "manager" }],
    });
  });
  it("refuses forged, removed or foreign colleague ids absent from the current eligible roster", () => {
    expect(resolveBranchTeam({ ...base, manager: { kind: "member", profileId: "someone-else" } })).toEqual({ ok: false, errorKey: "mbr.err.teamMember" });
    expect(resolveBranchTeam({ ...base, members: members.filter(person => person.profileId !== "marie"), manager: { kind: "member", profileId: "marie" } }).ok).toBe(false);
  });
  it("never demotes the business owner or assigns two roles to one person", () => {
    expect(resolveBranchTeam({ ...base, manager: { kind: "member", profileId: "owner" } }).ok).toBe(false);
    expect(resolveBranchTeam({ ...base, manager: { kind: "member", profileId: "marie" }, coOwner: { kind: "member", profileId: "marie" } }).ok).toBe(false);
    expect(resolveBranchTeam({ ...base, manager: { kind: "invite", email: "NEW@example.com" }, coOwner: { kind: "invite", email: " new@example.com " } }).ok).toBe(false);
  });
  it("creates email-bound invitations without granting active access to new people", () => {
    expect(resolveBranchTeam({ ...base, manager: { kind: "invite", email: " NEW@example.com " } })).toEqual({
      ok: true, assignments: [{ profileId: null, name: null, email: "new@example.com", role: "manager" }],
    });
    expect(resolveBranchTeam({ ...base, coOwner: { kind: "invite", email: "bad email" } }).ok).toBe(false);
    expect(resolveBranchTeam({ ...base, manager: { kind: "invite", email: "marie@example.com" } })).toEqual({ ok: false, errorKey: "mbr.err.teamExistingEmail" });
  });
  it("preserves the creating co-owner's access but does not enroll an impersonating admin", () => {
    expect(resolveBranchTeam({ ...base, actorOwnerId: "paul" })).toMatchObject({ ok: true, assignments: [{ profileId: "paul", role: "owner" }] });
    expect(resolveBranchTeam({ ...base, actorOwnerId: null })).toEqual({ ok: true, assignments: [] });
    expect(resolveBranchTeam({ ...base, actorOwnerId: "paul", manager: { kind: "member", profileId: "paul" } }).ok).toBe(false);
  });
  it("fails closed for an inactive main owner or malformed submitted choice", () => {
    expect(resolveBranchTeam({ ...base, members: members.slice(1) }).ok).toBe(false);
    expect(resolveBranchTeam({ ...base, manager: { kind: "admin" } as never }).ok).toBe(false);
    expect(resolveBranchTeam({ ...base, coOwner: null as never }).ok).toBe(false);
  });
});
