"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "./platform-actions";
import { trySendMail } from "@/lib/mail";
import { absoluteUrl } from "@/lib/site-url";
import { getBranding } from "@/lib/branding";

/**
 * Admin mutations.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY ACTION RE-CHECKS THE ROLE.
 *
 *  app/(admin)/layout.tsx already guards the pages, and proxy.ts already
 *  redirects anonymous visitors. Neither protects these functions: a Server
 *  Action is a POST endpoint with a generated URL, and it can be invoked
 *  directly without ever rendering the layout that "guards" it.
 *
 *  So `requireRole("admin")` is the first line of all of them. It is one
 *  database round-trip that we make anyway to render the page.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * `note` carries a caveat about an action that otherwise SUCCEEDED — chiefly
 * "the change was saved but the email could not be sent". Reporting that as a
 * plain success would be a lie; reporting it as a failure would be worse,
 * because the change really did happen.
 */
export type ActionResult = { ok: true; note?: string } | { ok: false; error: string };

/* ── Restaurants ───────────────────────────────────────────────────────── */

type RestaurantStatus = "active" | "pending" | "suspended";

const RESTAURANT_TRANSITIONS: Record<string, RestaurantStatus> = {
  approve: "active",
  reject: "pending",
  suspend: "suspended",
  reinstate: "active",
};

export async function setRestaurantStatus(
  restaurantId: string,
  action: "approve" | "reject" | "suspend" | "reinstate",
): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const status = RESTAURANT_TRANSITIONS[action];
  if (!status) return { ok: false, error: "Action inconnue." };

  const supabase = createAdminClient();

  // Read the owner first: after the update we still need somewhere to send the
  // approval email, and the join is cheaper than a second round trip later.
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name, branch_label, slug, owner_id, profiles!restaurants_owner_id_fkey ( name, email, status, deleted_at )")
    .eq("id", restaurantId)
    .maybeSingle();

  const { error } = await supabase
    .from("restaurants")
    .update({ status })
    .eq("id", restaurantId);

  if (error) {
    console.error("[admin:setRestaurantStatus]", action, restaurantId, error.message);
    return { ok: false, error: "The update failed." };
  }

  /**
   * APPROVING THE RESTAURANT MUST ALSO ACTIVATE ITS OWNER.
   *
   * ─────────────────────────────────────────────────────────────────────
   *  There are TWO statuses, and approving only ever touched one of them.
   *
   *    restaurants.status  — is the tenant listed to customers?
   *    profiles.status     — may this person sign in at all?
   *
   *  The signup trigger creates manager profiles as `pending`, and signIn
   *  refuses a pending profile with the `pending-manager` reason. So a
   *  restaurant could read "active" on /a/restaurants, be approved in the
   *  database, send its owner a "you are live" email — and that owner would
   *  still be told their account was awaiting approval, forever. Nothing in
   *  the product could clear it.
   *
   *  Only `pending` is lifted. A profile an admin has deliberately SUSPENDED
   *  stays suspended: approving one of their restaurants is not a decision
   *  about their account, and silently un-suspending someone here would undo
   *  a moderation action nobody revisited.
   * ─────────────────────────────────────────────────────────────────────
   */
  /**
   * AN APPROVED RESTAURANT MUST HAVE A SUBSCRIPTION.
   *
   * ─────────────────────────────────────────────────────────────────────
   *  Everything downstream reads `subscriptions`, and a restaurant without
   *  a row is not "on no plan" — it is ABSENT. It cannot be listed on
   *  /a/subscriptions, so an admin cannot see it, extend it or change its
   *  plan; and the manager's dashboard has to invent a state for it.
   *
   *  Starter costs 0 FCFA and never expires (end_date null, §5 rule 1), so
   *  granting it on approval commits the tenant to nothing and makes every
   *  screen downstream truthful. Upgrading is then an ordinary plan change
   *  rather than a special "first subscription" path that only runs once.
   * ─────────────────────────────────────────────────────────────────────
   */
  if (action === "approve") {
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (!existing) {
      const { data: starter } = await supabase
        .from("subscription_plans")
        .select("id")
        .eq("tier", "starter")
        .maybeSingle();

      if (starter) {
        // end_date null = never expires. Not a far-future date: §5 rule 1
        // says null is the only value that cannot be mistaken for a deadline.
        const { error: subError } = await supabase
          .from("subscriptions")
          .insert({ restaurant_id: restaurantId, plan_id: starter.id, end_date: null });

        if (subError) {
          console.error("[admin:setRestaurantStatus] starter subscription failed", subError.message);
        }
      } else {
        console.error("[admin:setRestaurantStatus] no 'starter' plan exists — run 0004.");
      }
    }
  }

  const owner = restaurant?.profiles as
    | { name: string; email: string; status: string; deleted_at: string | null }
    | null
    | undefined;

  if (action === "approve" && restaurant?.owner_id && owner?.status === "pending" && !owner.deleted_at) {
    const { error: ownerError } = await supabase
      .from("profiles")
      .update({ status: "active" })
      .eq("id", restaurant.owner_id)
      .eq("status", "pending");

    if (ownerError) {
      // Loud, because the restaurant is now live and its owner cannot get in.
      console.error("[admin:setRestaurantStatus] owner activation failed", ownerError.message);
    } else {
      await writeAudit(admin, {
        action: "user.activate",
        entityType: "profile",
        entityId: restaurant.owner_id,
        summary: `Activated on approval of ${restaurant.name}`,
      });
    }
  }

  await writeAudit(admin, {
    action: `restaurant.${action}`,
    entityType: "restaurant",
    entityId: restaurantId,
    summary: `Status set to ${status}`,
  });

  /**
   * Approval emails the applicant (§14.5).
   *
   * A failure here does NOT fail the approval — the restaurant is already
   * live. The caveat is returned as a note so the admin can follow up by hand
   * rather than assuming the owner was told.
   */
  let note: string | undefined;

  if (action === "approve" && owner?.email) {
    // Was a hardcoded https://restolink.cm/login — a domain that does not
    // exist, so every approval email shipped a dead link. It now points at
    // whatever host this deployment actually runs on.
    const loginUrl = await absoluteUrl("/login");
    const brand = await getBranding();

    const result = await trySendMail({
      to: owner.email,
      subject: `${restaurant?.name ?? "Your restaurant"} is now live on ${brand.name}`,
      body: [
        `Hello ${owner.name.split(" ")[0]},`,
        "",
        `Good news — ${restaurant?.name ?? "your restaurant"} has been approved and is now visible to customers.`,
        "",
        "You can sign in and start setting up your menu:",
        loginUrl,
        "",
        `— The ${brand.name} team`,
      ].join("\n"),
    });

    if (!result.sent) {
      note = `Approved, but the email was not sent (${result.reason}). Let ${owner.email} know directly.`;
    }
  } else if (action === "approve" && !owner?.email) {
    note = "Approved. No owner is attached to this restaurant, so nobody was emailed.";
  }

  revalidatePath("/a/restaurants");
  revalidatePath("/a");
  revalidatePath("/restaurants");
  return { ok: true, note };
}

/* ── Users ─────────────────────────────────────────────────────────────── */

export async function suspendUser(profileId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

  if (profileId === admin.id) {
    // Cheap guard against the most annoying possible mistake.
    return { ok: false, error: "Vous ne pouvez pas suspendre votre propre compte." };
  }

  const supabase = createAdminClient();

  const { data: target, error: readError } = await supabase
    .from("profiles")
    .select("auth_user_id, role")
    .eq("id", profileId)
    .maybeSingle();

  if (readError || !target) return { ok: false, error: "Utilisateur introuvable." };

  const { error } = await supabase
    .from("profiles")
    .update({ status: "suspended" })
    .eq("id", profileId);

  if (error) {
    console.error("[admin:suspendUser]", profileId, error.message);
    return { ok: false, error: "La suspension a échoué." };
  }

  /**
   * §12 hard rule #6 — suspension does nothing without session invalidation.
   *
   * Revoking the refresh tokens stops them getting a NEW access token. The one
   * already in their browser stays valid for up to an hour (B.2), which is why
   * getCurrentProfile() also checks `status` on every single request. Both
   * halves are required: this alone leaves an hour-long window, and the status
   * check alone would let them keep minting fresh tokens forever.
   */
  const { error: signOutError } = await supabase.auth.admin.signOut(target.auth_user_id, "global");
  if (signOutError) {
    console.error("[admin:suspendUser] token revocation failed", signOutError.message);
  }

  await writeAudit(admin, {
    action: "user.suspend",
    entityType: "profile",
    entityId: profileId,
    summary: "Account suspended and refresh tokens revoked",
  });

  revalidatePath("/a/users");
  revalidatePath("/a");
  return { ok: true };
}

export async function reinstateUser(profileId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ status: "active" })
    .eq("id", profileId)
    // Never resurrect an anonymised account: the identity fields are gone, so
    // "active" would mean a usable login attached to nobody.
    .is("deleted_at", null);

  if (error) {
    console.error("[admin:reinstateUser]", profileId, error.message);
    return { ok: false, error: "La réactivation a échoué." };
  }

  await writeAudit(admin, {
    action: "user.reinstate",
    entityType: "profile",
    entityId: profileId,
  });

  revalidatePath("/a/users");
  return { ok: true };
}

export async function anonymiseUser(profileId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

  if (profileId === admin.id) {
    return { ok: false, error: "Vous ne pouvez pas anonymiser votre propre compte." };
  }

  const supabase = createAdminClient();

  const { data: target, error: readError } = await supabase
    .from("profiles")
    .select("auth_user_id")
    .eq("id", profileId)
    .maybeSingle();

  if (readError || !target) return { ok: false, error: "Utilisateur introuvable." };

  /**
   * §12 hard rule #7 — ANONYMISE, NEVER DELETE.
   *
   * Deleting a user with orders would destroy the restaurant's sales history
   * and the platform's commission record. So the identity fields are
   * overwritten and every other row stays exactly where it is.
   *
   * The auth.users row is deleted, which revokes access permanently. The
   * profile survives it because profiles.auth_user_id is deliberately NOT a
   * foreign key to auth.users — the same decoupling that makes swapping to
   * Clerk a one-column change.
   */
  const suffix = profileId.slice(0, 8);

  const { error } = await supabase
    .from("profiles")
    .update({
      name: "Compte supprimé",
      email: `anonyme-${suffix}@supprime.local`,
      phone: null,
      avatar_url: null,
      status: "suspended",
      deleted_at: new Date().toISOString(),
    })
    .eq("id", profileId);

  if (error) {
    console.error("[admin:anonymiseUser]", profileId, error.message);
    return { ok: false, error: "L'anonymisation a échoué." };
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(target.auth_user_id);
  if (deleteError) {
    // The profile is already anonymised, so they cannot use the account. Worth
    // knowing about, not worth failing the whole operation over.
    console.error("[admin:anonymiseUser] auth user deletion failed", deleteError.message);
  }

  await writeAudit(admin, {
    action: "user.anonymise",
    entityType: "profile",
    entityId: profileId,
    summary: "Identity fields overwritten; financial history retained",
  });

  revalidatePath("/a/users");
  revalidatePath("/a");
  return { ok: true };
}

/* ── Service areas ─────────────────────────────────────────────────────── */

export async function createServiceArea(input: {
  city: string;
  country: string;
  currency: string;
  timezone: string;
  acceptingSignups: boolean;
}): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const city = input.city.trim();
  if (city.length < 2) return { ok: false, error: "City name is too short." };

  const supabase = createAdminClient();
  const { error } = await supabase.from("service_areas").insert({
    city,
    country: input.country.trim().toUpperCase(),
    currency: input.currency.trim().toUpperCase(),
    timezone: input.timezone.trim(),
    accepting_signups: input.acceptingSignups,
  });

  if (error) {
    console.error("[admin:createServiceArea]", error.code, error.message);
    // 23505 = unique_violation on (city, country).
    if (error.code === "23505") return { ok: false, error: `${city} already exists.` };
    return { ok: false, error: "Could not create the service area." };
  }

  await writeAudit(admin, { action: "area.create", entityType: "service_area", summary: city });
  revalidatePath("/a/areas");
  return { ok: true };
}

export async function updateServiceArea(
  areaId: string,
  input: { city: string; country: string; currency: string; timezone: string },
): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const city = input.city.trim();
  if (city.length < 2) return { ok: false, error: "City name is too short." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("service_areas")
    .update({
      city,
      country: input.country.trim().toUpperCase(),
      currency: input.currency.trim().toUpperCase(),
      timezone: input.timezone.trim(),
    })
    .eq("id", areaId);

  if (error) {
    console.error("[admin:updateServiceArea]", areaId, error.message);
    return { ok: false, error: "Could not update the service area." };
  }

  await writeAudit(admin, {
    action: "area.update",
    entityType: "service_area",
    entityId: areaId,
    summary: city,
  });
  revalidatePath("/a/areas");
  return { ok: true };
}

export async function deleteServiceArea(areaId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const supabase = createAdminClient();

  /**
   * Refuse if any restaurant still points at it.
   *
   * The foreign key is `on delete restrict`, so Postgres would refuse anyway —
   * but it would do so with a constraint-violation string that means nothing
   * to the person clicking Delete. Checking first turns that into a sentence
   * that tells them what to do about it.
   */
  const { count } = await supabase
    .from("restaurants")
    .select("*", { count: "exact", head: true })
    .eq("service_area_id", areaId);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} restaurant(s) are still in this area. Move or remove them first.`,
    };
  }

  const { error } = await supabase.from("service_areas").delete().eq("id", areaId);

  if (error) {
    console.error("[admin:deleteServiceArea]", areaId, error.message);
    return { ok: false, error: "Could not delete the service area." };
  }

  await writeAudit(admin, {
    action: "area.delete",
    entityType: "service_area",
    entityId: areaId,
  });
  revalidatePath("/a/areas");
  return { ok: true };
}

/* ── Quartiers ─────────────────────────────────────────────────────────── */

export async function createQuartier(areaId: string, name: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const clean = name.trim();
  if (clean.length < 2) return { ok: false, error: "Neighbourhood name is too short." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("quartiers")
    .insert({ service_area_id: areaId, name: clean, sort_order: 999 });

  if (error) {
    console.error("[admin:createQuartier]", error.code, error.message);
    if (error.code === "23505") return { ok: false, error: `${clean} already exists here.` };
    return { ok: false, error: "Could not add the neighbourhood." };
  }

  await writeAudit(admin, {
    action: "quartier.create",
    entityType: "quartier",
    entityId: areaId,
    summary: clean,
  });
  revalidatePath("/a/areas");
  return { ok: true };
}

export async function setQuartierActive(
  quartierId: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireRole("admin");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("quartiers")
    .update({ is_active: isActive })
    .eq("id", quartierId);

  if (error) {
    console.error("[admin:setQuartierActive]", quartierId, error.message);
    return { ok: false, error: "Could not update the neighbourhood." };
  }

  revalidatePath("/a/areas");
  return { ok: true };
}

export async function deleteQuartier(quartierId: string): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const supabase = createAdminClient();

  // restaurants.quartier_id is `on delete set null`, so deleting would silently
  // strip the neighbourhood off every restaurant using it. Deactivating keeps
  // existing tenants intact while hiding it from new signups.
  const { count } = await supabase
    .from("restaurants")
    .select("*", { count: "exact", head: true })
    .eq("quartier_id", quartierId);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} restaurant(s) use this neighbourhood. Deactivate it instead of deleting.`,
    };
  }

  const { error } = await supabase.from("quartiers").delete().eq("id", quartierId);

  if (error) {
    console.error("[admin:deleteQuartier]", quartierId, error.message);
    return { ok: false, error: "Could not delete the neighbourhood." };
  }

  await writeAudit(admin, {
    action: "quartier.delete",
    entityType: "quartier",
    entityId: quartierId,
  });
  revalidatePath("/a/areas");
  return { ok: true };
}

export async function setAreaAcceptingSignups(
  areaId: string,
  accepting: boolean,
): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("service_areas")
    .update({ accepting_signups: accepting })
    .eq("id", areaId);

  if (error) {
    console.error("[admin:setAreaAcceptingSignups]", areaId, error.message);
    return { ok: false, error: "La mise à jour a échoué." };
  }

  await writeAudit(admin, {
    action: "area.accepting_signups",
    entityType: "service_area",
    entityId: areaId,
    summary: accepting ? "Signups opened" : "Signups closed",
  });

  revalidatePath("/a/areas");
  return { ok: true };
}
