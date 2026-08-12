import { AdminPage } from "@/components/layout/admin-shell";
import { AppearanceForm } from "./appearance-form";
import { requireRole } from "@/lib/auth/session";
import { getAppearance, APPEARANCE_IMAGES, DEFAULT_APPEARANCE } from "@/lib/appearance";

export const metadata = { title: "Appearance" };

// Reads settings rows an administrator is in the middle of changing.
export const dynamic = "force-dynamic";

export default async function AppearancePage() {
  await requireRole("admin");
  const appearance = await getAppearance();

  // `current` is what the site renders; `isDefault` is whether that came from
  // a stored row or from the shipped fallback. The screen has to distinguish
  // them — "this is the default" and "someone chose this photograph, which
  // happens to be the same one" are different facts, and only one of them
  // makes the Reset button meaningful.
  const slots = APPEARANCE_IMAGES.map((image) => ({
    key: image.key,
    field: image.field,
    current: appearance[image.field],
    isDefault: appearance[image.field] === DEFAULT_APPEARANCE[image.field],
  }));

  return (
    <AdminPage
      title="Appearance"
      description="The photographs on the public landing page. Changes are live the moment you save."
    >
      <AppearanceForm slots={slots} />
    </AdminPage>
  );
}
