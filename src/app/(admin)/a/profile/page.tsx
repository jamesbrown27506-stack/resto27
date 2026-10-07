import { AdminPage } from "@/components/layout/admin-shell";
import { ProfileForm } from "./profile-form";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AdminProfilePage() {
  const admin = await requireRole("admin");

  // created_at is not on AuthProfile, so it is read here rather than widening
  // the session type for one display field.
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("created_at")
    .eq("id", admin.id)
    .maybeSingle();

  return (
    <AdminPage title="My profile" description="Your own details and sign-in credentials.">
      <Link href="/security?next=/a/profile" className={buttonClasses({ variant: "outline", className: "mb-6" })}>Email verification and optional 2FA</Link>
      <ProfileForm
        profile={{
          name: admin.name,
          email: admin.email,
          phone: admin.phone,
          avatarUrl: admin.avatarUrl,
          role: admin.role,
          createdAt: data?.created_at ?? new Date().toISOString(),
        }}
      />
    </AdminPage>
  );
}
