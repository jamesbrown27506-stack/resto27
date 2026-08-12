import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { requireCapability } from "@/lib/auth/branch";
import { fetchCuisines, fetchQuartiers, fetchRestaurantProfile } from "@/lib/data/profile";
import { ProfileForm, ProfileMissing } from "./profile-form";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["nav.m.profile"] };
}

/**
 * Never cached: this is the page a manager comes back to right after saving,
 * and a stale copy of their own profile reads as the save having failed.
 */
export const dynamic = "force-dynamic";

export default async function RestaurantProfilePage() {
  // The branch comes from the session, never from the URL — every read below is
  // scoped to it, and the service-role key bypasses RLS entirely.
  const { active } = await requireCapability("profile.edit");

  const [profile, cuisines] = await Promise.all([
    fetchRestaurantProfile(active.restaurantId),
    fetchCuisines(),
  ]);

  // Quartiers belong to a city, so they can only be listed once the restaurant
  // row has said which service area it is in — offering a Douala restaurant the
  // Yaoundé list is not a mistake anybody should be able to make by accident.
  const quartiers = profile ? await fetchQuartiers(profile.serviceAreaId) : [];

  return (
    <ManagerPage titleKey="mpf.title" descriptionKey="mpf.subtitle">
      {profile ? (
        // Keyed on the branch: the form seeds its draft from these props ONCE,
        // so switching location has to remount it rather than leave the
        // previous restaurant's name sitting in the field.
        <ProfileForm
          key={profile.id}
          profile={profile}
          cuisines={cuisines}
          quartiers={quartiers}
        />
      ) : (
        <ProfileMissing />
      )}
    </ManagerPage>
  );
}
