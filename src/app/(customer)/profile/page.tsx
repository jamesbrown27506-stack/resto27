import { ProfileClient } from "./profile-client";
import { requireUser } from "@/lib/auth/session";

export default async function ProfilePage() {
  const user = await requireUser();

  return <ProfileClient user={user} />;
}