import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import {
  effectiveSuperAdmin,
  superAdminColumnMissing,
  type AdminSubject,
} from "@/lib/auth/super-admin-rules";

/**
 * The administrators read layer (/a/admins and the super-admin guards).
 *
 * Admin client, like lib/data/admin.ts: authorization already happened in
 * the caller (requireRole / superAdminOrError), and RLS only lets a user read
 * their own profile row.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  MIGRATION-TOLERANT. Until 0063 runs there is no `is_super_admin` column;
 *  every read retries without it and `effectiveSuperAdmin` treats each admin
 *  as super — the same answer lib/auth/session.ts gives, so the guards and
 *  the list never disagree about who may do what.
 * ─────────────────────────────────────────────────────────────────────────
 */

const SUBJECT_COLUMNS = "id, role, status, deleted_at";

interface SubjectRow {
  id: string;
  role: string;
  status: string;
  deleted_at: string | null;
  is_super_admin?: boolean | null;
}

function toSubject(row: SubjectRow): AdminSubject {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    deletedAt: row.deleted_at,
    isSuperAdmin: effectiveSuperAdmin(row.role, row.is_super_admin),
  };
}

/**
 * Every administrator as the rules need them, or null if the read failed.
 *
 * Null, not []: the callers use this to protect the LAST super admin, and an
 * empty list after an error would read as "there are none" — the one answer
 * that must never be guessed. Callers fail closed on null.
 */
export async function loadAdminSubjects(): Promise<AdminSubject[] | null> {
  const supabase = createAdminClient();
  let result = await supabase
    .from("profiles")
    .select(`${SUBJECT_COLUMNS}, is_super_admin`)
    .eq("role", "admin");

  if (superAdminColumnMissing(result.error)) {
    result = (await supabase.from("profiles").select(SUBJECT_COLUMNS).eq("role", "admin")) as typeof result;
  }

  if (result.error) {
    console.error("[admins:loadAdminSubjects]", result.error.message);
    return null;
  }
  return ((result.data ?? []) as SubjectRow[]).map(toSubject);
}

/** One profile as a rule subject, or null when it does not exist. */
export async function loadSubject(profileId: string): Promise<AdminSubject | null> {
  const supabase = createAdminClient();
  let result = await supabase
    .from("profiles")
    .select(`${SUBJECT_COLUMNS}, is_super_admin`)
    .eq("id", profileId)
    .maybeSingle();

  if (superAdminColumnMissing(result.error)) {
    result = (await supabase
      .from("profiles")
      .select(SUBJECT_COLUMNS)
      .eq("id", profileId)
      .maybeSingle()) as typeof result;
  }

  if (result.error || !result.data) return null;
  return toSubject(result.data as SubjectRow);
}

/** Whether migration 0063 has run — the admin page says so when it has not. */
export async function superAdminColumnExists(): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("profiles").select("is_super_admin").limit(1);
  return !superAdminColumnMissing(error);
}

export interface AdministratorRow {
  id: string;
  name: string;
  email: string;
  status: string;
  isSuperAdmin: boolean;
  createdAt: string;
  /** From Supabase Auth; null if they never signed in (e.g. invite pending). */
  lastSignInAt: string | null;
  /** Invited but the invitation link has not been used yet. */
  invitePending: boolean;
}

/**
 * The /a/admins list.
 *
 * Last sign-in lives in auth.users, not profiles, so it is read per admin
 * through the Auth admin API. Administrators are a handful of rows, so N
 * small calls are fine — and one failing just leaves that cell blank rather
 * than failing the page.
 */
export async function listAdministrators(): Promise<AdministratorRow[]> {
  const supabase = createAdminClient();
  const BASE = "id, auth_user_id, name, email, status, deleted_at, created_at";

  let result = await supabase
    .from("profiles")
    .select(`${BASE}, role, is_super_admin`)
    .eq("role", "admin")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (superAdminColumnMissing(result.error)) {
    result = (await supabase
      .from("profiles")
      .select(`${BASE}, role`)
      .eq("role", "admin")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })) as typeof result;
  }

  if (result.error) {
    console.error("[admins:listAdministrators]", result.error.message);
    return [];
  }

  const rows = (result.data ?? []) as {
    id: string;
    auth_user_id: string;
    name: string;
    email: string;
    status: string;
    role: string;
    created_at: string;
    is_super_admin?: boolean | null;
  }[];

  return Promise.all(
    rows.map(async (row) => {
      let lastSignInAt: string | null = null;
      let invitePending = false;
      try {
        const { data } = await supabase.auth.admin.getUserById(row.auth_user_id);
        lastSignInAt = data.user?.last_sign_in_at ?? null;
        invitePending = Boolean(data.user?.invited_at) && !data.user?.last_sign_in_at;
      } catch {
        // Unreadable auth row — show the admin without a sign-in date.
      }
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        status: row.status,
        isSuperAdmin: effectiveSuperAdmin(row.role, row.is_super_admin),
        createdAt: row.created_at,
        lastSignInAt,
        invitePending,
      };
    }),
  );
}
