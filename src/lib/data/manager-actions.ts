"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability, setActiveBranch } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import { trySendMail } from "@/lib/mail";
import { notify } from "@/lib/notify";
import type { BranchRole } from "@/lib/capabilities";
import type { ActionResult } from "./admin-actions";

/**
 * Restaurant-side mutations.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY ACTION RE-CHECKS THE CAPABILITY, AND NONE TAKES A restaurantId.
 *
 *  A Server Action is a POST endpoint with a generated URL. It never passes
 *  through the layout that guarded its page, so the page's check protects
 *  nothing here. Each action calls requireCapability() itself.
 *
 *  The branch is READ FROM THE SESSION, never accepted as an argument. If a
 *  waiter could post `restaurantId` they would edit any restaurant's menu —
 *  the capability check would pass, because it would be checking the wrong
 *  restaurant. Taking the id out of the signature makes that class of bug
 *  unrepresentable rather than merely avoided.
 * ─────────────────────────────────────────────────────────────────────────
 */

/* ── Branch switching ──────────────────────────────────────────────────── */

export async function switchBranch(restaurantId: string): Promise<ActionResult> {
  const ok = await setActiveBranch(restaurantId);
  if (!ok) return { ok: false, error: "You do not work at that branch." };

  revalidatePath("/m", "layout");
  return { ok: true };
}

/* ── Service state ─────────────────────────────────────────────────────── */

/**
 * Pause or resume orders.
 *
 * Distinct from suspension: `status` is the platform's verdict, this is the
 * restaurant saying "not tonight". A kitchen that is swamped needs to stop the
 * queue without being unpublished, and a public page that just hides the order
 * button with no explanation reads as broken.
 */
export async function setAcceptingOrders(accepting: boolean, reason?: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("settings.manage");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("restaurants")
    .update({
      is_accepting_orders: accepting,
      paused_reason: accepting ? null : (reason?.trim() || null),
    })
    .eq("id", active.restaurantId);

  if (error) return { ok: false, error: "Could not change the service state." };

  await writeAudit(profile, {
    action: accepting ? "restaurant.resumed" : "restaurant.paused",
    entityType: "restaurant",
    entityId: active.restaurantId,
    summary: accepting ? "Orders resumed" : `Orders paused${reason ? `: ${reason}` : ""}`,
  });

  revalidatePath("/m", "layout");
  return { ok: true };
}

/* ── Menu: categories ──────────────────────────────────────────────────── */

export async function createCategory(input: { name: string; icon?: string }): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Category name is too short." };

  const supabase = createAdminClient();

  // Appended, not inserted at the top: a new category arriving above the one
  // customers know is a surprise nobody asked for.
  const { data: last } = await supabase
    .from("menu_categories")
    .select("sort_order")
    .eq("restaurant_id", active.restaurantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("menu_categories").insert({
    restaurant_id: active.restaurantId,
    name,
    icon: input.icon?.trim() || "UtensilsCrossed",
    sort_order: (last?.sort_order ?? 0) + 1,
  });

  if (error) {
    // The unique constraint is (restaurant_id, name), so this is the one
    // failure worth naming — everything else is a bug, not a user mistake.
    if (error.code === "23505") return { ok: false, error: "You already have a category with that name." };
    console.error("[manager:createCategory]", error.message);
    return { ok: false, error: "Could not create the category." };
  }

  revalidatePath("/m/categories");
  revalidatePath("/m/menu");
  return { ok: true };
}

export async function updateCategory(
  id: string,
  input: { name?: string; icon?: string; sortOrder?: number; isActive?: boolean },
): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");
  const supabase = createAdminClient();

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.icon !== undefined) patch.icon = input.icon.trim();
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const { error } = await supabase
    .from("menu_categories")
    .update(patch)
    .eq("id", id)
    // The tenant guard. Without it, an id from a form edits any restaurant's
    // category, because the service-role key bypasses RLS.
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not save the category." };

  revalidatePath("/m/categories");
  revalidatePath("/m/menu");
  return { ok: true };
}

/**
 * Delete a category.
 *
 * The items survive — `category_id` is `on delete set null`, so they become
 * uncategorised and visible rather than silently disappearing with the
 * category. The caller is told how many moved, because "deleted" and "deleted,
 * and 23 dishes are now uncategorised" are different pieces of news.
 */
export async function deleteCategory(id: string): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");
  const supabase = createAdminClient();

  const { count } = await supabase
    .from("menu_items")
    .select("*", { count: "exact", head: true })
    .eq("restaurant_id", active.restaurantId)
    .eq("category_id", id);

  const { error } = await supabase
    .from("menu_categories")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not delete the category." };

  revalidatePath("/m/categories");
  revalidatePath("/m/menu");

  return count && count > 0
    ? { ok: true, note: `Category deleted. ${count} dish${count === 1 ? "" : "es"} are now uncategorised.` }
    : { ok: true };
}

/* ── Menu: items ───────────────────────────────────────────────────────── */

export interface MenuItemInput {
  categoryId: string | null;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string | null;
  isAvailable?: boolean;
  isFeatured?: boolean;
  prepMinutes?: number;
  trackStock?: boolean;
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
  dietaryTags?: string;
  allergens?: string;
}

/** Shared by create and update, so the two can never validate differently. */
function validateItem(input: MenuItemInput): string | null {
  if (input.name.trim().length < 2) return "Dish name is too short.";
  // XAF is zero-decimal: a price is a whole number of francs or it is wrong.
  if (!Number.isInteger(input.price) || input.price < 0) return "Price must be a whole number of francs.";
  if (input.price > 10_000_000) return "That price looks like a mistake.";
  if (input.trackStock && (input.stockQuantity ?? null) === null) {
    return "Set a stock quantity, or turn stock tracking off.";
  }
  return null;
}

function itemPatch(input: MenuItemInput): Record<string, unknown> {
  const tracking = input.trackStock ?? false;

  return {
    category_id: input.categoryId,
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    price: input.price,
    image_url: input.imageUrl || null,
    is_available: input.isAvailable ?? true,
    is_featured: input.isFeatured ?? false,
    prep_minutes: input.prepMinutes ?? 15,
    track_stock: tracking,
    // Cleared when tracking is off, rather than left behind. A stale count
    // that reappears the day someone re-enables tracking is worse than none.
    stock_quantity: tracking ? (input.stockQuantity ?? 0) : null,
    low_stock_threshold: tracking ? (input.lowStockThreshold ?? null) : null,
    dietary_tags: input.dietaryTags?.trim() ?? "",
    allergens: input.allergens?.trim() ?? "",
  };
}

export async function createMenuItem(input: MenuItemInput): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  const invalid = validateItem(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();

  const { data: last } = await supabase
    .from("menu_items")
    .select("sort_order")
    .eq("restaurant_id", active.restaurantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("menu_items")
    .insert({ ...itemPatch(input), restaurant_id: active.restaurantId, sort_order: (last?.sort_order ?? 0) + 1 });

  if (error) {
    console.error("[manager:createMenuItem]", error.message);
    return { ok: false, error: "Could not add the dish." };
  }

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function updateMenuItem(id: string, input: MenuItemInput): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  const invalid = validateItem(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("menu_items")
    .update(itemPatch(input))
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not save the dish." };

  revalidatePath("/m/menu");
  return { ok: true };
}

/**
 * The one-tap toggle from the menu list.
 *
 * Separate from updateMenuItem because "we've run out of Poulet DG" happens
 * mid-service, on a phone, and must not require opening an edit form.
 */
export async function setItemAvailability(id: string, available: boolean): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("menu_items")
    .update({ is_available: available })
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not change availability." };

  revalidatePath("/m/menu");
  revalidatePath("/m/kitchen");
  return { ok: true };
}

/**
 * Delete a dish.
 *
 * Safe despite the sales history, because `order_items` SNAPSHOTS the name and
 * price and holds `menu_item_id` as a bare uuid with no foreign key (§12 rule
 * 7). Past orders keep reading correctly after the dish is gone — which is why
 * the snapshot exists.
 */
export async function deleteMenuItem(id: string): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not delete the dish." };

  revalidatePath("/m/menu");
  return { ok: true };
}

/* ── Menu: option groups and options ───────────────────────────────────── */

/**
 * Confirm an item belongs to the active branch.
 *
 * Option groups carry no restaurant_id, so `.eq("restaurant_id", …)` cannot be
 * used on them. Every option mutation therefore proves ownership through the
 * item first. Returning null rather than throwing keeps the callers uniform.
 */
async function ownedItemId(restaurantId: string, menuItemId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("menu_items")
    .select("id")
    .eq("id", menuItemId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  return data?.id ?? null;
}

async function ownedGroupId(restaurantId: string, groupId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("menu_option_groups")
    .select("id, menu_items!inner(restaurant_id)")
    .eq("id", groupId)
    .maybeSingle();

  const row = data as unknown as { id: string; menu_items: { restaurant_id: string } } | null;
  return row && row.menu_items.restaurant_id === restaurantId ? row.id : null;
}

export async function createOptionGroup(input: {
  menuItemId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
}): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  if (input.name.trim().length < 2) return { ok: false, error: "Group name is too short." };
  if (input.maxSelect < 1) return { ok: false, error: "Maximum must be at least 1." };
  if (input.maxSelect < input.minSelect) {
    return { ok: false, error: "Maximum cannot be below minimum — nobody could submit that." };
  }
  if (input.isRequired && input.minSelect < 1) {
    return { ok: false, error: "A required group needs a minimum of at least 1." };
  }

  if (!(await ownedItemId(active.restaurantId, input.menuItemId))) {
    return { ok: false, error: "That dish is not on this branch's menu." };
  }

  const supabase = createAdminClient();
  const { data: last } = await supabase
    .from("menu_option_groups")
    .select("sort_order")
    .eq("menu_item_id", input.menuItemId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("menu_option_groups").insert({
    menu_item_id: input.menuItemId,
    name: input.name.trim(),
    min_select: input.minSelect,
    max_select: input.maxSelect,
    is_required: input.isRequired,
    sort_order: (last?.sort_order ?? 0) + 1,
  });

  if (error) {
    console.error("[manager:createOptionGroup]", error.message);
    return { ok: false, error: "Could not create the option group." };
  }

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function deleteOptionGroup(groupId: string): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  if (!(await ownedGroupId(active.restaurantId, groupId))) {
    return { ok: false, error: "That option group is not on this branch's menu." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("menu_option_groups").delete().eq("id", groupId);

  if (error) return { ok: false, error: "Could not delete the option group." };

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function createOption(input: {
  groupId: string;
  name: string;
  priceDelta: number;
}): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  if (input.name.trim().length < 1) return { ok: false, error: "Option name is required." };
  // Negative is legitimate — "sans viande, −500 F" is a real menu line — so
  // only non-integers are rejected here.
  if (!Number.isInteger(input.priceDelta)) {
    return { ok: false, error: "Price difference must be a whole number of francs." };
  }

  if (!(await ownedGroupId(active.restaurantId, input.groupId))) {
    return { ok: false, error: "That option group is not on this branch's menu." };
  }

  const supabase = createAdminClient();
  const { data: last } = await supabase
    .from("menu_options")
    .select("sort_order")
    .eq("group_id", input.groupId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("menu_options").insert({
    group_id: input.groupId,
    name: input.name.trim(),
    price_delta: input.priceDelta,
    sort_order: (last?.sort_order ?? 0) + 1,
  });

  if (error) return { ok: false, error: "Could not add the option." };

  revalidatePath("/m/menu");
  return { ok: true };
}

/** Two hops up — option → group → item — because only the item knows the tenant. */
async function ownsOption(restaurantId: string, optionId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("menu_options")
    .select("id, menu_option_groups!inner(menu_items!inner(restaurant_id))")
    .eq("id", optionId)
    .maybeSingle();

  const row = data as unknown as
    | { id: string; menu_option_groups: { menu_items: { restaurant_id: string } } }
    | null;

  return row?.menu_option_groups.menu_items.restaurant_id === restaurantId;
}

export async function setOptionAvailability(optionId: string, available: boolean): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  if (!(await ownsOption(active.restaurantId, optionId))) {
    return { ok: false, error: "That option is not on this branch's menu." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("menu_options")
    .update({ is_available: available })
    .eq("id", optionId);

  if (error) return { ok: false, error: "Could not change availability." };

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function deleteOption(optionId: string): Promise<ActionResult> {
  const { active } = await requireCapability("menu.edit");

  if (!(await ownsOption(active.restaurantId, optionId))) {
    return { ok: false, error: "That option is not on this branch's menu." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("menu_options").delete().eq("id", optionId);
  if (error) return { ok: false, error: "Could not delete the option." };

  revalidatePath("/m/menu");
  return { ok: true };
}

/* ── Staff ─────────────────────────────────────────────────────────────── */

/**
 * Invite someone to work at this branch.
 *
 * If the address already has an account, the staff row is linked to it
 * immediately and they can simply sign in — no invitation to accept. If it
 * does not, a token is issued and the row waits at `invited` until they
 * register. Both paths end in a row on this branch's roster, which is what the
 * person doing the inviting expects to see.
 */
export async function inviteStaff(input: {
  email: string;
  role: BranchRole;
  name?: string;
}): Promise<ActionResult> {
  const { active, profile } = await requireCapability("staff.manage");

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That email address is not valid." };

  // Only an owner may create another owner. A manager promoting someone above
  // themselves is a privilege-escalation path, not a feature.
  if (input.role === "owner" && active.role !== "owner") {
    return { ok: false, error: "Only the owner can add another owner." };
  }

  const supabase = createAdminClient();

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingProfile) {
    const { data: already } = await supabase
      .from("restaurant_staff")
      .select("id, status")
      .eq("restaurant_id", active.restaurantId)
      .eq("profile_id", existingProfile.id)
      .maybeSingle();

    if (already) {
      if (already.status === "active") return { ok: false, error: "They already work at this branch." };

      // Reinstating a suspended colleague is the same gesture as inviting one.
      const { error } = await supabase
        .from("restaurant_staff")
        .update({ status: "active", role: input.role })
        .eq("id", already.id);

      if (error) return { ok: false, error: "Could not reinstate them." };
      revalidatePath("/m/staff");
      return { ok: true, note: "They already had a record here and have been reinstated." };
    }

    const { error } = await supabase.from("restaurant_staff").insert({
      restaurant_id: active.restaurantId,
      profile_id: existingProfile.id,
      role: input.role,
      status: "active",
      invited_email: email,
      invited_by: profile.id,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
      display_name: existingProfile.name,
    });

    if (error) {
      console.error("[manager:inviteStaff] link existing", error.message);
      return { ok: false, error: "Could not add them to the team." };
    }
  } else {
    // randomUUID, not Math.random: this token is a credential — anyone holding
    // it joins the payroll. It is single-use and expires in seven days,
    // because invite links get forwarded.
    const token = randomUUID();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const { error } = await supabase.from("restaurant_staff").insert({
      restaurant_id: active.restaurantId,
      role: input.role,
      status: "invited",
      invited_email: email,
      invited_by: profile.id,
      invite_token: token,
      invite_expires: expires.toISOString(),
      invited_at: new Date().toISOString(),
      display_name: input.name?.trim() || null,
    });

    if (error) {
      if (error.code === "23505") return { ok: false, error: "An invitation is already open for that address." };
      console.error("[manager:inviteStaff]", error.message);
      return { ok: false, error: "Could not send the invitation." };
    }
  }

  await writeAudit(profile, {
    action: "staff.invited",
    entityType: "restaurant_staff",
    entityId: active.restaurantId,
    summary: `Invited ${email} as ${input.role} at ${active.restaurantName}`,
  });

  const mail = await trySendMail({
    to: email,
    subject: `Rejoignez ${active.restaurantName} sur RestoLink`,
    body: [
      `Bonjour${input.name ? ` ${input.name}` : ""},`,
      "",
      `${profile.name} vous invite à rejoindre l'équipe de ${active.restaurantName} sur RestoLink.`,
      "",
      `Créez votre compte avec cette adresse (${email}) pour accéder au tableau de bord.`,
      "",
      "— RestoLink",
    ].join("\n"),
  });

  revalidatePath("/m/staff");

  // The record is created either way, so nothing is lost if the send fails —
  // but claiming success for an email that never left would leave the manager
  // waiting for someone who was never told.
  return mail.sent
    ? { ok: true }
    : { ok: true, note: `Added, but not emailed (${mail.reason}). Tell ${email} directly.` };
}

export async function changeStaffRole(staffId: string, role: BranchRole): Promise<ActionResult> {
  const { active, profile } = await requireCapability("staff.manage");
  const supabase = createAdminClient();

  const { data: member } = await supabase
    .from("restaurant_staff")
    .select("id, role, profile_id, invited_email")
    .eq("id", staffId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!member) return { ok: false, error: "No such team member at this branch." };

  if (role === "owner" && active.role !== "owner") {
    return { ok: false, error: "Only the owner can appoint another owner." };
  }

  /**
   * A branch must never be left without an owner.
   *
   * Demoting the last one locks everybody — including the person doing it —
   * out of billing and staff management, with no route back short of a
   * platform admin. Checked here rather than trusted to the UI, because the UI
   * is not what a POST goes through.
   */
  if (member.role === "owner" && role !== "owner") {
    const { count } = await supabase
      .from("restaurant_staff")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", active.restaurantId)
      .eq("role", "owner")
      .eq("status", "active");

    if ((count ?? 0) <= 1) {
      return { ok: false, error: "This is the only owner. Appoint another one first." };
    }
  }

  const { error } = await supabase.from("restaurant_staff").update({ role }).eq("id", staffId);
  if (error) return { ok: false, error: "Could not change their role." };

  await writeAudit(profile, {
    action: "staff.role_changed",
    entityType: "restaurant_staff",
    entityId: staffId,
    summary: `${member.invited_email ?? "member"} at ${active.restaurantName}: ${member.role} → ${role}`,
  });

  revalidatePath("/m/staff");
  return { ok: true };
}

/**
 * Suspend, rather than delete.
 *
 * The row stays so the orders and status changes they recorded keep naming
 * somebody (§12 rule 7). A deleted employee turns last week's service history
 * into a list of anonymous events.
 */
export async function suspendStaff(staffId: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("staff.manage");
  const supabase = createAdminClient();

  const { data: member } = await supabase
    .from("restaurant_staff")
    .select("id, role, profile_id, invited_email")
    .eq("id", staffId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!member) return { ok: false, error: "No such team member at this branch." };

  if (member.profile_id === profile.id) {
    return { ok: false, error: "You cannot remove yourself." };
  }

  if (member.role === "owner") {
    const { count } = await supabase
      .from("restaurant_staff")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", active.restaurantId)
      .eq("role", "owner")
      .eq("status", "active");

    if ((count ?? 0) <= 1) return { ok: false, error: "This is the only owner." };
  }

  const { error } = await supabase
    .from("restaurant_staff")
    .update({ status: "suspended" })
    .eq("id", staffId);

  if (error) return { ok: false, error: "Could not suspend them." };

  await writeAudit(profile, {
    action: "staff.suspended",
    entityType: "restaurant_staff",
    entityId: staffId,
    summary: `${member.invited_email ?? "member"} suspended at ${active.restaurantName}`,
  });

  revalidatePath("/m/staff");
  return { ok: true };
}

export async function reinstateStaff(staffId: string): Promise<ActionResult> {
  const { active } = await requireCapability("staff.manage");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("restaurant_staff")
    .update({ status: "active" })
    .eq("id", staffId)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not reinstate them." };

  revalidatePath("/m/staff");
  return { ok: true };
}

export async function cancelInvite(staffId: string): Promise<ActionResult> {
  const { active } = await requireCapability("staff.manage");
  const supabase = createAdminClient();

  // An unaccepted invitation is the one staff row that CAN be deleted: nobody
  // has done anything under it, so there is no history to orphan.
  const { error } = await supabase
    .from("restaurant_staff")
    .delete()
    .eq("id", staffId)
    .eq("restaurant_id", active.restaurantId)
    .eq("status", "invited");

  if (error) return { ok: false, error: "Could not cancel the invitation." };

  revalidatePath("/m/staff");
  return { ok: true };
}

/* ── Reservations ──────────────────────────────────────────────────────── */

export async function decideReservation(
  reservationId: string,
  decision: "confirmed" | "cancelled",
  input: { tableId?: string | null; reason?: string } = {},
): Promise<ActionResult> {
  const { active, profile } = await requireCapability("reservations.decide");

  if (decision === "cancelled" && !input.reason?.trim()) {
    // A refusal with no reason is the thing guests complain about, so the
    // reason is required rather than optional-in-practice.
    return { ok: false, error: "Give a reason — the guest is told what it is." };
  }

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, reference, customer_id, guest_name")
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  const { error } = await supabase
    .from("reservations")
    .update({
      status: decision,
      table_id: decision === "confirmed" ? (input.tableId ?? null) : null,
      decided_by: profile.email,
      decided_at: new Date().toISOString(),
      decline_reason: decision === "cancelled" ? input.reason!.trim() : null,
    })
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not save the decision." };

  // The guest hears the verdict — and a refusal must never arrive without the
  // reason the restaurant was forced to give.
  if (reservation?.customer_id) {
    await notify({
      event: "reservation_decision",
      tone: decision === "confirmed" ? "success" : "error",
      customerId: reservation.customer_id,
      href: "/reservations",
      params: {
        reference: reservation.reference,
        restaurantName: active.restaurantName,
        status: decision as "confirmed" | "cancelled",
        reason: decision === "cancelled" ? input.reason?.trim() : undefined,
      },
    });
  }

  revalidatePath("/m/reservations");
  return { ok: true };
}

export async function setReservationStatus(
  reservationId: string,
  status: "seated" | "completed" | "no_show",
): Promise<ActionResult> {
  const { active } = await requireCapability("reservations.decide");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not update the reservation." };

  revalidatePath("/m/reservations");
  return { ok: true };
}

/* ── Promotions ────────────────────────────────────────────────────────── */

export async function createPromotion(input: {
  code: string;
  label?: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  minOrder?: number;
  maxDiscount?: number | null;
  endsAt?: string | null;
  usageLimit?: number | null;
}): Promise<ActionResult> {
  const { active } = await requireCapability("promotions.manage");

  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,24}$/.test(code)) {
    return { ok: false, error: "Codes are 3–24 letters and digits, no spaces." };
  }

  if (input.discountType === "percent" && (input.discountValue < 1 || input.discountValue > 100)) {
    return { ok: false, error: "A percentage discount must be between 1 and 100." };
  }
  if (input.discountValue <= 0) return { ok: false, error: "The discount must be greater than zero." };

  // An uncapped percentage is how a 20% code becomes a 40 000 F gift on one
  // large group booking. Warned about rather than blocked — it is a legitimate
  // choice, just rarely the intended one.
  const note =
    input.discountType === "percent" && !input.maxDiscount
      ? "Created without a maximum discount — a large order will take the full percentage."
      : undefined;

  const supabase = createAdminClient();
  const { error } = await supabase.from("promotions").insert({
    restaurant_id: active.restaurantId,
    code,
    label: input.label?.trim() ?? "",
    discount_type: input.discountType,
    discount_value: input.discountValue,
    min_order: input.minOrder ?? 0,
    max_discount: input.maxDiscount ?? null,
    ends_at: input.endsAt || null,
    usage_limit: input.usageLimit ?? null,
  });

  if (error) {
    if (error.code === "23505") return { ok: false, error: "You already have a code with that name." };
    console.error("[manager:createPromotion]", error.message);
    return { ok: false, error: "Could not create the promotion." };
  }

  revalidatePath("/m/promotions");
  return { ok: true, note };
}

export async function setPromotionActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { active } = await requireCapability("promotions.manage");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("promotions")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not change the promotion." };

  revalidatePath("/m/promotions");
  return { ok: true };
}

/* ── Reviews ───────────────────────────────────────────────────────────── */

export async function replyToReview(reviewId: string, reply: string): Promise<ActionResult> {
  const { active, profile } = await requireCapability("reviews.reply");

  if (reply.trim().length < 5) return { ok: false, error: "The reply is too short." };

  const supabase = createAdminClient();
  // `.select()` so we can tell "updated" from "matched nothing". PostgREST
  // returns no error for an UPDATE that hits zero rows, so without this a
  // reply to a review that platform moderation had already taken down — or
  // that vanished while the dialog was open — returned ok and the manager was
  // told they had answered a customer in public when they had not.
  const { data, error } = await supabase
    .from("reviews")
    .update({
      reply: reply.trim(),
      replied_at: new Date().toISOString(),
      replied_by: profile.name,
    })
    .eq("id", reviewId)
    .eq("restaurant_id", active.restaurantId)
    .is("removed_at", null)
    .select("id, customer_id");

  if (error) return { ok: false, error: "Could not post the reply." };
  if ((data ?? []).length === 0) {
    return { ok: false, error: "That review is no longer available." };
  }

  // The reviewer is told their word was heard.
  const replied = (data as { id: string; customer_id: string | null }[])[0];
  if (replied?.customer_id) {
    await notify({
      event: "review_reply",
      tone: "success",
      customerId: replied.customer_id,
      href: "/reviews",
      params: { restaurantName: active.restaurantName, reply: reply.trim() },
    });
  }

  revalidatePath("/m/reviews");
  return { ok: true };
}

/* ── Tables ────────────────────────────────────────────────────────────── */

export async function upsertTable(input: {
  id?: string;
  number: string;
  capacity: number;
}): Promise<ActionResult> {
  const { active } = await requireCapability("tables.manage");

  const number = input.number.trim();
  if (!number) return { ok: false, error: "A table needs a number." };
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return { ok: false, error: "Capacity must be at least 1." };
  }

  const supabase = createAdminClient();

  const { error } = input.id
    ? await supabase
        .from("restaurant_tables")
        .update({ number, capacity: input.capacity })
        .eq("id", input.id)
        .eq("restaurant_id", active.restaurantId)
    : await supabase
        .from("restaurant_tables")
        .insert({ restaurant_id: active.restaurantId, number, capacity: input.capacity });

  if (error) {
    if (error.code === "23505") return { ok: false, error: "That table number is already in use." };
    return { ok: false, error: "Could not save the table." };
  }

  revalidatePath("/m/tables");
  return { ok: true };
}

export async function setTableStatus(
  id: string,
  status: "available" | "occupied" | "reserved" | "out_of_service",
): Promise<ActionResult> {
  const { active } = await requireCapability("tables.manage");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("restaurant_tables")
    .update({ status })
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: "Could not update the table." };

  revalidatePath("/m/tables");
  return { ok: true };
}

/* ── Profile ───────────────────────────────────────────────────────────── */

export async function updateRestaurantProfile(input: {
  name?: string;
  branchLabel?: string;
  description?: string;
  phone?: string;
  addressLine?: string;
  cuisineId?: string | null;
  quartierId?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  deliveryEstimateMin?: number;
  minimumOrder?: number;
  acceptsDelivery?: boolean;
  acceptsPickup?: boolean;
}): Promise<ActionResult> {
  const { active, profile } = await requireCapability("profile.edit");

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (input.name.trim().length < 2) return { ok: false, error: "The restaurant name is too short." };
    patch.name = input.name.trim();
  }
  // Distinguishes two locations of the same restaurant ("Akwa", "Bonapriso"),
  // so it is never empty — a blank one leaves two identical rows in the branch
  // switcher with no way to tell which is which.
  if (input.branchLabel !== undefined) {
    const label = input.branchLabel.trim();
    if (label.length < 2) return { ok: false, error: "The branch name is too short." };
    patch.branch_label = label;
  }
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.phone !== undefined) patch.phone = input.phone.trim();
  if (input.addressLine !== undefined) patch.address_line = input.addressLine.trim();
  if (input.cuisineId !== undefined) patch.cuisine_id = input.cuisineId;
  if (input.quartierId !== undefined) patch.quartier_id = input.quartierId;
  if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl;
  if (input.coverUrl !== undefined) patch.cover_url = input.coverUrl;
  if (input.deliveryEstimateMin !== undefined) patch.delivery_estimate_min = input.deliveryEstimateMin;
  if (input.minimumOrder !== undefined) patch.minimum_order = input.minimumOrder;
  if (input.acceptsDelivery !== undefined) patch.accepts_delivery = input.acceptsDelivery;
  if (input.acceptsPickup !== undefined) patch.accepts_pickup = input.acceptsPickup;

  // The slug is deliberately absent. Changing it breaks every link a
  // restaurant has ever shared, and there is no redirect table yet.

  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = createAdminClient();
  const { error } = await supabase.from("restaurants").update(patch).eq("id", active.restaurantId);

  if (error) {
    console.error("[manager:updateRestaurantProfile]", error.message);
    return { ok: false, error: "Could not save the changes." };
  }

  await writeAudit(profile, {
    action: "restaurant.profile_updated",
    entityType: "restaurant",
    entityId: active.restaurantId,
    summary: `Updated: ${Object.keys(patch).join(", ")}`,
  });

  revalidatePath("/m", "layout");
  return { ok: true };
}
