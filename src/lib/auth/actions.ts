"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { removeFirebaseDevice } from "@/lib/data/firebase-actions";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { rateLimit } from "@/lib/rate-limit";
import { notify } from "@/lib/notify";
import { resolveOrCreateQuartier } from "@/lib/data/quartiers";
import {
  forgotPasswordSchema,
  resetCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpCustomerSchema,
  signUpRestaurantSchema,
} from "./schemas";
import { getManagerRestaurantRejection, type RejectionReason } from "./session";
import { syncStaffRole } from "./staff-access";
import { signInFailureReason } from "./sign-in-failure";

/**
 * The profile behind a sign-in that just succeeded, read with the SERVER's
 * key and retried once.
 *
 * It was read with the brand-new session, which is exactly the request that
 * Supabase's intermittent "JWT issued at future" clock skew hits (see
 * lib/supabase/server.ts), and any failure — a timeout included — came back
 * as "no profile", i.e. "wrong password". The admin client carries no user
 * JWT, one retry absorbs a blip, and a real failure is reported as what it is.
 */
async function loadSignInProfile(
  authUserId: string,
): Promise<{ id: string; role: string; status: string; deleted_at: string | null } | null | "unavailable"> {
  const admin = createAdminClient();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, role, status, deleted_at")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (!error) return data;
    console.error(`[auth:signIn] profile read failed (attempt ${attempt})`, error.message);
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return "unavailable";
}

/** What every auth action returns, so forms can render errors uniformly. */
export interface AuthState {
  ok: boolean;
  /** Drives the specific message on /login (§14.2). */
  reason?: RejectionReason;
  /** Non-field error, already user-facing. */
  error?: string;
  /** Per-field messages, keyed by input name. */
  fieldErrors?: Record<string, string>;
  /** Set on flows that end on a confirmation screen rather than a redirect. */
  done?: boolean;
}

/** Flatten a Zod error into the shape the forms expect. */
function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * Turn a Supabase auth failure into something a person can act on.
 *
 * The first version of this returned one generic sentence for everything,
 * which is fine for the caller and useless for anyone debugging: a missing
 * database trigger, an already-registered address and a rate limit all looked
 * identical. The real message now goes to the server log every time, and the
 * cases worth naming get named.
 *
 * "Already registered" is deliberately NOT treated as a hard error elsewhere —
 * see the note in `signUpCustomer` — but when Supabase does surface it we may
 * as well say so rather than let someone retry the same address forever.
 */
function describeAuthError(error: { message?: string; status?: number }, context: string): string {
  const raw = error.message ?? "";

  // Always log. Server-side only — never reaches the browser.
  console.error(`[auth:${context}]`, error.status ?? "", raw);

  const lower = raw.toLowerCase();

  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez votre mot de passe.";
  }

  if (lower.includes("database error")) {
    // Almost always the handle_new_user() trigger failing — usually because
    // the migration has not been run, or was run partially.
    return "Erreur de base de données à la création du compte. La migration 0001_auth_profiles.sql a-t-elle été exécutée ?";
  }

  if (lower.includes("rate limit") || error.status === 429) {
    return "Trop de tentatives. Réessayez dans quelques minutes.";
  }

  if (lower.includes("signups not allowed") || lower.includes("signup is disabled")) {
    return "Les inscriptions sont désactivées sur ce projet Supabase (Authentication → Sign In / Providers).";
  }

  if (lower.includes("password")) {
    return "Mot de passe refusé par le serveur : " + raw;
  }

  // Nothing matched. Show the real message rather than a shrug — this is a
  // pre-launch build, and an opaque failure costs more than the detail leaks.
  return raw || "Impossible de créer le compte. Réessayez.";
}

/**
 * The base URL for emailed links (§11).
 *
 * Moved to lib/site-url, which is deliberately NOT "derive it from the
 * request": the Host header is attacker-controlled, and a password-reset link
 * built from it can be pointed at someone else's domain while carrying a real
 * token. See that file for the full reasoning.
 */

/* ── Sign in ───────────────────────────────────────────────────────────── */

/**
 * §14.2: returns a SPECIFIC reason on failure — invalid / pending /
 * pending-manager / suspended.
 *
 * This looks like an information leak and is not. In every case except
 * `invalid`, the credentials have already been proven correct, so naming the
 * reason tells the caller nothing they could not already establish. What it
 * does change is whether a restaurant applicant waits patiently or concludes
 * we lost their registration.
 */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // Brute force on the password field, throttled per IP before Supabase is
  // even reached. 10 attempts in 5 minutes is generous for a human and a
  // wall for a script.
  const limited = await rateLimit({ key: "auth:signin", limit: 10, windowMs: 5 * 60_000 });
  if (!limited.ok) {
    return {
      ok: false,
      error: "Trop de tentatives. Réessayez dans quelques minutes.",
    };
  }

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember") === "on",
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Not every refusal is a wrong password — see sign-in-failure.ts. The
    // ones that are not get logged, so the next outage is in the logs rather
    // than in a stack of password resets.
    const reason = signInFailureReason(error);
    if (reason !== "invalid") {
      console.error("[auth:signIn]", reason, error?.status, error?.code, error?.message);
    }
    return { ok: false, reason };
  }

  // Credentials were correct. Now: are they still allowed in?
  const profile = await loadSignInProfile(data.user.id);

  if (profile === "unavailable") {
    // The password was right; the database did not answer. Nothing was
    // decided, so nobody is told their credentials are wrong.
    await supabase.auth.signOut();
    return { ok: false, reason: "unavailable" };
  }

  if (!profile) {
    // A real account with no profile row — an orphan (0002_backfill_profiles).
    console.error("[auth:signIn] orphan: auth user has no profile", data.user.id);
    await supabase.auth.signOut();
    return { ok: false, reason: "invalid" };
  }

  if (profile.deleted_at || profile.status === "suspended") {
    // Sign out immediately — a suspended account must not keep a usable token.
    await supabase.auth.signOut();
    return { ok: false, reason: "suspended" };
  }

  if (profile.status === "pending") {
    await supabase.auth.signOut();
    return { ok: false, reason: profile.role === "manager" ? "pending-manager" : "pending" };
  }

  try {
    profile.role = await syncStaffRole(profile);
  } catch {
    await supabase.auth.signOut();
    return { ok: false, reason: "unavailable" };
  }

  if (profile.role === "manager") {
    const reason = await getManagerRestaurantRejection(profile.id);
    if (reason) {
      await supabase.auth.signOut();
      return { ok: false, reason };
    }
  }

  revalidatePath("/", "layout");

  /**
   * Return them to where they were headed, or to their own dashboard.
   *
   * `next` comes from a query string the proxy wrote, but a query string is
   * attacker-controllable — a crafted `?next=https://evil.example` on a login
   * link would send a freshly authenticated user straight off our domain.
   * Only same-site paths are honoured, and `//` is rejected because
   * `//evil.example` is protocol-relative, not a path.
   */
  const requested = String(formData.get("next") ?? "");
  const safeNext =
    requested.startsWith("/") && !requested.startsWith("//") ? requested : null;

  redirect(
    safeNext ??
      (profile.role === "admin" ? "/a" : profile.role === "manager" ? "/m" : "/account"),
  );
}

/* ── Sign up — customer ────────────────────────────────────────────────── */

export async function signUpCustomer(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  // Account-creation spam: a handful of real people can register in an hour;
  // a botnet can register thousands. Per IP, per hour.
  const limited = await rateLimit({ key: "auth:signup-customer", limit: 5, windowMs: 60 * 60_000 });
  if (!limited.ok) {
    return { ok: false, error: "Trop d'inscriptions depuis cette adresse. Réessayez dans une heure." };
  }

  const parsed = signUpCustomerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    terms: formData.get("terms") === "on",
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
      // Read by the handle_new_user() trigger. `role` is floored to
      // customer|manager there — an 'admin' arriving here is not trusted.
      data: {
        name: parsed.data.name,
        phone: parsed.data.phone,
        role: "customer",
      },
    },
  });

  if (error) {
    return { ok: false, error: describeAuthError(error, "signup-customer") };
  }

  /**
   * Branch on whether Supabase handed back a session.
   *
   * With "Confirm email" OFF, signUp returns a live session and the account is
   * usable immediately — so send them straight in rather than to a screen
   * telling them to check an inbox that will never receive anything.
   *
   * With it ON, `session` is null and the confirmation screen is correct.
   *
   * Reading the session rather than a config flag of our own means flipping
   * the Supabase setting needs no code change in either direction, and the two
   * can never disagree.
   */
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/account");
  }

  return { ok: true, done: true };
}

/* ── Sign up — restaurant ──────────────────────────────────────────────── */

/** URL-safe form of a restaurant name: accents folded, punctuation dropped. */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Creates the user AND the restaurant, both `pending` (§14.2).
 *
 * The trigger sets status = 'pending' from the role, so an applicant cannot
 * sign in until an admin approves — and /login tells them exactly that rather
 * than refusing them anonymously.
 *
 * THIS IS TWO WRITES ACROSS TWO SYSTEMS: an auth user in Supabase's schema and
 * a restaurant in ours. There is no transaction spanning them, so if the
 * second fails the first is DELETED (see below). Leaving a half-application
 * behind would be worse than failing outright: the address is taken, so the
 * applicant cannot retry, and there is no restaurant for an admin to approve.
 */
export async function signUpRestaurant(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  // Each application creates an auth user AND a restaurant row — expensive
  // writes an attacker could use to exhaust storage or flood the admin
  // approval queue. Same budget as customer signup.
  const limited = await rateLimit({ key: "auth:signup-restaurant", limit: 5, windowMs: 60 * 60_000 });
  if (!limited.ok) {
    return { ok: false, error: "Trop d'inscriptions depuis cette adresse. Réessayez dans une heure." };
  }

  const parsed = signUpRestaurantSchema.safeParse({
    ownerName: formData.get("ownerName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    restaurantName: formData.get("restaurantName"),
    description: formData.get("description") || undefined,
    serviceAreaId: formData.get("serviceAreaId"),
    quartier: formData.get("quartier"),
    address: formData.get("address"),
    restaurantPhone: formData.get("restaurantPhone"),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const input = parsed.data;
  const admin = createAdminClient();

  // The town must still be open. It was when the form was rendered; an admin
  // can close a city between then and submit, and honouring a stale form would
  // create a tenant in a city nobody is staffed to approve.
  const { data: area } = await admin
    .from("service_areas")
    .select("id, city, accepting_signups")
    .eq("id", input.serviceAreaId)
    .maybeSingle();

  if (!area || !area.accepting_signups) {
    return {
      ok: false,
      fieldErrors: { serviceAreaId: "Cette ville n'accepte pas d'inscriptions pour le moment." },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
      data: { name: input.ownerName, phone: input.phone, role: "manager" },
    },
  });

  if (error || !data.user) {
    return { ok: false, error: describeAuthError(error ?? {}, "signup-restaurant") };
  }

  /**
   * Restaurants do NOT get signed in, even when email confirmation is off.
   *
   * The trigger sets their status to `pending` — they are waiting on admin
   * approval (§14.2). Leaving the session that signUp just handed back would
   * put them in a state where the proxy sees a user and lets them past /login,
   * while every guarded page bounces them straight back out. Dropping it here
   * keeps the state honest: no session, and a screen that explains why.
   */
  if (data.session) {
    await supabase.auth.signOut();
  }

  const authUserId = data.user.id;

  /** Undo the auth user, so the applicant can try again with the same email. */
  async function rollback(context: string, detail: string): Promise<AuthState> {
    console.error(`[auth:signup-restaurant] ${context}:`, detail);
    await admin.auth.admin.deleteUser(authUserId).catch(() => {
      // If even this fails the address is stranded. Say so in the log — an
      // admin can delete the user by hand, and silence would hide it.
      console.error("[auth:signup-restaurant] ROLLBACK FAILED for", authUserId);
    });
    return { ok: false, error: "Impossible d'enregistrer l'établissement. Réessayez." };
  }

  // The profile is created by the handle_new_user() trigger, not by us. Read
  // it back for its id — restaurants.owner_id references profiles, not
  // auth.users, so the auth id is the wrong key (see B.2).
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!profile) {
    return rollback("profile missing after signup", "handle_new_user() did not fire");
  }

  /**
   * The neighbourhood, as a row.
   *
   * The field accepts anything typed, but `restaurants.quartier_id` is a
   * foreign key — so an unrecognised name is CREATED here, and created ACTIVE
   * so the next applicant from the same street is offered it instead of
   * typing a fourth spelling of it. See lib/data/quartiers for the full
   * reasoning and the race handling.
   */
  const quartierId = await resolveOrCreateQuartier(input.quartier, area.id);

  if (!quartierId) {
    return rollback("quartier resolve", `could not resolve or create "${input.quartier}"`);
  }

  // Slug collisions are real — two "Chez Marcel" in the same city is normal.
  // Suffix until it takes rather than failing the application over a name.
  const base = slugify(input.restaurantName) || "restaurant";
  let slug = base;
  for (let attempt = 2; attempt <= 50; attempt++) {
    const { data: clash } = await admin
      .from("restaurants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${base}-${attempt}`;
  }

  const { error: restaurantError } = await admin.from("restaurants").insert({
    owner_id: profile.id,
    slug,
    name: input.restaurantName,
    status: "pending",
    service_area_id: area.id,
    quartier_id: quartierId,
    description: input.description ?? "",
    phone: input.restaurantPhone,
    address_line: input.address,
  });

  if (restaurantError) {
    return rollback("restaurant insert", restaurantError.message);
  }

  // The application is written; the admin's bell is how it is ever seen. A
  // failed notification must not fail the signup (the row is already there),
  // and notify() never throws — but the news still has to be sent.
  await notify({
    event: "application",
    tone: "info",
    admins: true,
    href: "/a/restaurants",
    params: { restaurantName: input.restaurantName },
  });

  return { ok: true, done: true };
}

/* ── Sign out ──────────────────────────────────────────────────────────── */

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await removeFirebaseDevice();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/* ── Password reset ────────────────────────────────────────────────────── */

/**
 * ALWAYS reports success (§14.2), whether or not the address exists.
 *
 * Anything else is an account-enumeration oracle: submit a list of addresses,
 * read the differing responses, learn who has an account here. Note that the
 * Supabase error is swallowed for the same reason — a rate-limit error would
 * otherwise reveal that the address was real.
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  // SMTP is the expensive resource here — a mail bomb costs us money per
  // message. The response stays "ok: true" either way: revealing that we
  // throttled would turn the limiter into an account-enumeration oracle.
  const limited = await rateLimit({ key: "auth:reset", limit: 5, windowMs: 60 * 60_000 });
  if (!limited.ok) return { ok: true, done: true };

  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password`,
  });

  return { ok: true, done: true };
}

/**
 * Signs in with the CODE from the reset email, then hands over to the
 * new-password screen — the same one-time proof as the emailed link, typed
 * where the reset started instead of travelling through a browser.
 *
 * Why a code at all: see app/(auth)/forgot-password. The session it creates is
 * exactly the one the link would have created, so /reset-password and
 * `updatePassword` below serve both without knowing which was used.
 */
export async function verifyResetCode(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // Six digits can be guessed in a way a link cannot, so guesses are
  // throttled per IP — on top of Supabase's own limit on verifications.
  const limited = await rateLimit({ key: "auth:reset-code", limit: 10, windowMs: 15 * 60_000 });
  if (!limited.ok) return { ok: false, error: "rate" };

  const parsed = resetCodeSchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "recovery",
  });

  // Wrong, expired or already used — one answer for all three.
  if (error) return { ok: false, error: "code" };

  redirect("/reset-password");
}

/**
 * Sets a new password for the session established by the reset link.
 *
 * `updateUser` revokes the account's other refresh tokens, so every other
 * device is signed out — which is the point of a reset: if someone else had
 * the old password, changing it must also end whatever they were logged into.
 */
export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // A stolen reset link is a password-change oracle: anyone holding one can
  // keep submitting new passwords until one sticks. Throttle per IP.
  const limited = await rateLimit({ key: "auth:update-password", limit: 5, windowMs: 60 * 60_000 });
  if (!limited.ok) {
    return { ok: false, error: "Trop de tentatives. Réessayez dans une heure." };
  }

  const supabase = await createClient();

  // The reset link creates a session; without one there is nothing to update,
  // which is what an expired or already-used link looks like.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "expired" };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { ok: false, error: "Impossible de modifier le mot de passe. Réessayez." };
  }

  await supabase.auth.signOut();
  return { ok: true, done: true };
}
