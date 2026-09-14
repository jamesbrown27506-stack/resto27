import { describe, expect, it } from "vitest";
import { accountLinksFor } from "./account-links";
import { BRANCH_ROLES, can } from "./capabilities";

const hrefs = (links: { href: string }[]) => links.map((link) => link.href);

describe("avatar menu", () => {
  it("a customer can edit their profile and reach their account and settings", () => {
    expect(hrefs(accountLinksFor("customer"))).toEqual(["/profile", "/account", "/settings"]);
  });

  it("every staff member can manage their own profile", () => {
    for (const role of [...BRANCH_ROLES, null]) {
      expect(hrefs(accountLinksFor("manager", role))).toContain("/profile");
    }
  });

  it("only staff allowed to edit it are offered the restaurant's profile", () => {
    for (const role of BRANCH_ROLES) {
      expect(hrefs(accountLinksFor("manager", role)).includes("/m/profile"), role).toBe(can(role, "profile.edit"));
    }
    expect(hrefs(accountLinksFor("manager", null))).not.toContain("/m/profile");
  });

  it("an administrator gets their dashboard and their own profile", () => {
    expect(hrefs(accountLinksFor("admin"))).toEqual(["/a", "/a/profile"]);
  });
});
