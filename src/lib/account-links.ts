import type { IconName } from "@/components/layout/icon";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { can, type BranchRole } from "@/lib/capabilities";

export interface AccountLink {
  href: string;
  icon: IconName;
  labelKey: TranslationKey;
}

/**
 * What the avatar menu offers, per area — the same list in the site header and
 * in the manager shell, so the menu does not change with the page either.
 *
 * Staff get two profiles, and they are different things: their OWN (name,
 * photo, password — the account page every signed-in person has) and the
 * RESTAURANT's, which customers see. The second is offered only with
 * `profile.edit`; the page re-checks it server-side, this only keeps a waiter
 * from being shown a door that refuses them.
 */
export function accountLinksFor(area: "customer" | "manager" | "admin", role: BranchRole | null = null): AccountLink[] {
  switch (area) {
    case "manager":
      return [
        { href: "/m", icon: "LayoutDashboard", labelKey: "nav.m.dashboard" },
        { href: "/profile", icon: "User", labelKey: "acct.personalProfile" },
        // Their own ring / push / quiet hours — every role (see /m/notifications).
        ...(role ? [{ href: "/m/notifications", icon: "Bell", labelKey: "mops.nav.notifications" } satisfies AccountLink] : []),
        ...(role && can(role, "profile.edit")
          ? [{ href: "/m/profile", icon: "Store", labelKey: "nav.m.profile" } satisfies AccountLink]
          : []),
      ];
    case "admin":
      return [
        { href: "/a", icon: "LayoutDashboard", labelKey: "nav.m.dashboard" },
        { href: "/a/profile", icon: "User", labelKey: "common.myProfile" },
      ];
    default:
      return [
        { href: "/profile", icon: "User", labelKey: "acct.editProfile" },
        { href: "/account", icon: "LayoutDashboard", labelKey: "cac.title" },
        { href: "/settings", icon: "Settings", labelKey: "cst.title" },
      ];
  }
}
