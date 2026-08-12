import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { StaffManager } from "./staff-manager";
import { requireCapability } from "@/lib/auth/branch";
import { fetchStaff } from "@/lib/data/manager";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

// The roster changes the moment somebody is invited, suspended or accepts.
// A cached copy would show a colleague who no longer has access.
export const dynamic = "force-dynamic";

// The browser tab is a user-visible string too, so it reads the same locale
// cookie the page renders with rather than being hardcoded French.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mst.title"] };
}

/**
 * `staff.manage` guards the whole page, not just the buttons.
 *
 * Unlike the menu, there is no read-only view worth showing a waiter: the
 * roster with everyone's email and role is exactly the sort of thing a branch
 * role is meant to scope.
 */
export default async function StaffPage() {
  const { active, profile } = await requireCapability("staff.manage");
  const staff = await fetchStaff(active.restaurantId);

  return (
    // A Server Component cannot call useLocale, so it hands ManagerPage KEYS.
    // The restaurant's own name is not a translatable phrase, so the line that
    // names it is built in the client component from an interpolated key.
    <ManagerPage titleKey="mst.title" descriptionKey="mst.subtitle">
      <StaffManager
        staff={staff}
        myProfileId={profile.id}
        // Only an owner may create or demote another owner. Passed down so the
        // form can hide the option — the action refuses it regardless.
        isOwner={active.role === "owner"}
        restaurantName={active.restaurantName}
        // A single-location restaurant is seeded with the label "Principal";
        // repeating it beside the restaurant's own name says nothing. Only a
        // real second address earns the chip.
        branchLabel={
          active.isPrimary || active.branchLabel.trim() === "" || active.branchLabel === "Principal"
            ? null
            : active.branchLabel
        }
      />
    </ManagerPage>
  );
}
