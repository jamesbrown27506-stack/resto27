"use server";

import { notifyWaitlist } from "./waitlist";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability, setActiveBranch } from "@/lib/auth/branch";
import { writeAudit } from "./platform-actions";
import { trySendMail } from "@/lib/mail";
import { absoluteUrl } from "@/lib/site-url";
import { notify } from "@/lib/notify";
import { releaseTableIfFree } from "./order-actions";
import { POPULAR_DISH_BY_ID, type DishTemplate } from "./dish-templates";
import { normaliseDepositType, type DepositType } from "@/lib/reservations/deposit";
import {
  canDecideReservation,
  canManagerCollectReservationDeposit,
  canRestaurantCancelReservation,
  canSetReservationStatus,
} from "@/lib/reservations/lifecycle";
import { canMarkNoShowYet, noShowAllowedFrom, NO_SHOW_GRACE_MIN } from "@/lib/reservations/timing";
import {
  MAX_RESERVATION_DURATION_MIN,
  MIN_RESERVATION_DURATION_MIN,
} from "@/lib/reservations/availability";
import { durationColumnMissing } from "@/lib/reservations/duration-server";
import { startRefundPayout } from "@/lib/payments/refund-payouts";
import type { CustomerReservationStatus } from "@/lib/format/reservation-status";
import type { BranchRole } from "@/lib/capabilities";
import type { ActionResult } from "./admin-actions";
import { fetchTableAccess } from "./table-access";
import { DICTIONARIES, type TranslationKey } from "@/lib/i18n/dictionaries";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";

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
  const t = await getTranslator();
  const ok = await setActiveBranch(restaurantId);
  if (!ok) return { ok: false, error: t("est.notAtBranch") };

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
  const t = await getTranslator();
  const { active, profile } = await requireCapability("service.pause");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("restaurants")
    .update({
      is_accepting_orders: accepting,
      paused_reason: accepting ? null : (reason?.trim() || null),
    })
    .eq("id", active.restaurantId);

  if (error) return { ok: false, error: t("est.serviceStateFailed") };

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
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: t("est.categoryNameShort") };

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
    if (error.code === "23505") return { ok: false, error: t("est.categoryExists") };
    console.error("[manager:createCategory]", error.message);
    return { ok: false, error: t("est.categoryCreateFailed") };
  }

  revalidatePath("/m/categories");
  revalidatePath("/m/menu");
  return { ok: true };
}

export async function updateCategory(
  id: string,
  input: { name?: string; icon?: string; sortOrder?: number; isActive?: boolean },
): Promise<ActionResult> {
  const t = await getTranslator();
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

  if (error) return { ok: false, error: t("est.categorySaveFailed") };

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
  const t = await getTranslator();
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

  if (error) return { ok: false, error: t("est.categoryDeleteFailed") };

  revalidatePath("/m/categories");
  revalidatePath("/m/menu");

  return count && count > 0
    ? { ok: true, note: t(count === 1 ? "est.categoryDeletedOne" : "est.categoryDeletedMany", { count }) }
    : { ok: true };
}

/**
 * Seed a brand-new restaurant with a starter set of categories.
 *
 * A restaurant whose menu has nowhere to file dishes ends up with an empty
 * public carte while the manager's dashboard is full — the worst kind of
 * failure, because nobody is told. Entrées / Plats principaux / Desserts /
 * Boissons is the shape almost every kitchen's menu takes; the manager can
 * rename or delete them like any other category.
 *
 * Idempotent: only runs when the restaurant has no categories at all, and the
 * upsert ignores duplicates — so it never fights a manager who deliberately
 * deleted everything.
 *
 * Gated on menu.view (the menu page's own guard) on purpose: even a kitchen
 * staff member opening the carte first should not leave the public menu
 * permanently empty for want of categories.
 */
export async function ensureDefaultCategories(): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.view");
  const supabase = createAdminClient();

  const { count } = await supabase
    .from("menu_categories")
    .select("*", { count: "exact", head: true })
    .eq("restaurant_id", active.restaurantId);
  if (count && count > 0) return { ok: true };

  const defaults = [
    { name: "Entrées", icon: "Soup" },
    { name: "Plats principaux", icon: "UtensilsCrossed" },
    { name: "Desserts", icon: "Dessert" },
    { name: "Boissons", icon: "CupSoda" },
  ];

  const { error } = await supabase.from("menu_categories").upsert(
    defaults.map((c, i) => ({
      restaurant_id: active.restaurantId,
      name: c.name,
      icon: c.icon,
      sort_order: i,
    })),
    { onConflict: "restaurant_id,name", ignoreDuplicates: true },
  );

  if (error) {
    console.error("[manager:ensureDefaultCategories]", error.message);
    return { ok: false, error: t("est.defaultCategoriesFailed") };
  }

  revalidatePath("/m/categories");
  revalidatePath("/m/menu");
  return { ok: true };
}

/**
 * Seed the restaurant's menu with the popular Cameroonian dishes it picked
 * during first-login setup.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE DISHES ARE COPIES, NOT REFERENCES (§12's snapshot rule).
 *
 *  The templates live in code (lib/data/dish-templates.ts); each accepted
 *  dish is written into the restaurant's OWN menu_items row with its own
 *  price, and from that moment the manager edits it like any other dish —
 *  renaming, re-pricing or deleting it never touches the template list.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The ids are validated against the template list — a client can send a
 * subset, an empty list, or an id it saw in the picker; nothing else is
 * honoured. The dishes land in "Plats principaux" (ensured first); an
 * existing dish with the same name is skipped rather than duplicated.
 *
 * Gated on `menu.view` like ensureDefaultCategories: every role holds it,
 * and the wizard is the first screen any of them may see.
 */
export interface SeededDish {
  id: string;
  /**
   * What the restaurant will charge, in whole XAF.
   *
   * The templates carry a uniform 2 500 "just start" price, which is a
   * placeholder and reads as one. A restaurant that accepts the starter menu
   * and never notices is now listing eleven dishes at a price it does not
   * charge — so the picker lets the price be typed in place, and this is how
   * it arrives. Omitted means "take the template's price".
   */
  price?: number;
}

export async function seedPopularDishes(selections: SeededDish[]): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.view");

  // De-duplicate by id, keeping the LAST price given for each — the picker
  // can legitimately send the same dish twice if its state ever doubles up,
  // and silently seeding it twice would be worse than picking one price.
  const byId = new Map<string, SeededDish>();
  for (const selection of selections) byId.set(selection.id, selection);

  const chosen = [...byId.values()]
    .map((selection) => {
      const template = POPULAR_DISH_BY_ID.get(selection.id);
      if (!template) return null;

      // The price is typed by a person into a free-text box, so it is
      // validated here rather than trusted: a negative or fractional price
      // would violate the menu_items check constraint and fail the whole
      // insert, taking every other chosen dish down with it. Anything not
      // usable falls back to the template's own price — the restaurant can
      // fix one number on /m/menu, which beats losing the entire seed.
      const price =
        selection.price !== undefined &&
        Number.isFinite(selection.price) &&
        Number.isInteger(selection.price) &&
        selection.price >= 0
          ? selection.price
          : template.price;

      return { ...template, price };
    })
    .filter((d): d is DishTemplate => Boolean(d));
  if (chosen.length === 0) return { ok: true };

  const supabase = createAdminClient();

  await ensureDefaultCategories();

  const { data: categories } = await supabase
    .from("menu_categories")
    .select("id, name")
    .eq("restaurant_id", active.restaurantId)
    .order("sort_order");
  const mainCategory =
    (categories ?? []).find((c) => c.name === "Plats principaux") ??
    (categories ?? [])[0] ??
    null;

  // Never duplicate what the restaurant already typed in itself.
  const { data: existing } = await supabase
    .from("menu_items")
    .select("name")
    .eq("restaurant_id", active.restaurantId);
  const taken = new Set((existing ?? []).map((i) => i.name));

  const { data: last } = await supabase
    .from("menu_items")
    .select("sort_order")
    .eq("restaurant_id", active.restaurantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sort = (last?.sort_order ?? 0) + 1;
  const inserts = chosen
    .filter((d) => !taken.has(d.name))
    .map((d) => ({
      restaurant_id: active.restaurantId,
      category_id: (categories ?? []).find(c => c.name === d.category)?.id ?? mainCategory?.id ?? null,
      name: d.name,
      description: d.description,
      price: d.price,
      image_url: d.image,
      is_available: true,
      is_featured: false,
      prep_minutes: 0,
      track_stock: false,
      stock_quantity: null,
      low_stock_threshold: null,
      dietary_tags: "",
      allergens: "",
      sort_order: sort++,
    }));

  if (inserts.length === 0) return { ok: true };

  const { error } = await supabase.from("menu_items").insert(inserts);
  if (error) {
    console.error("[manager:seedPopularDishes]", error.message);
    return { ok: false, error: t("est.dishesAddFailed") };
  }

  revalidatePath("/m/menu");
  revalidatePath("/m/categories");
  return { ok: true };
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

/**
 * Shared by create and update, so the two can never validate differently.
 * Returns a dictionary KEY, not a sentence: this helper has no request of its
 * own, so each caller translates it in the viewer's language.
 */
function validateItem(input: MenuItemInput): TranslationKey | null {
  if (input.name.trim().length < 2) return "est.dishNameShort";
  // XAF is zero-decimal: a price is a whole number of francs or it is wrong.
  if (!Number.isInteger(input.price) || input.price < 0) return "est.priceWhole";
  if (input.price > 10_000_000) return "est.priceMistake";
  if (input.trackStock && (input.stockQuantity ?? null) === null) {
    return "est.stockQuantity";
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
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  const invalid = validateItem(input);
  if (invalid) return { ok: false, error: t(invalid) };

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
    return { ok: false, error: t("est.dishAddFailed") };
  }

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function updateMenuItem(id: string, input: MenuItemInput): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  const invalid = validateItem(input);
  if (invalid) return { ok: false, error: t(invalid) };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("menu_items")
    .update(itemPatch(input))
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: t("est.dishSaveFailed") };

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
  const t = await getTranslator();
  const { active } = await requireCapability("menu.availability");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("menu_items")
    .update({ is_available: available })
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: t("est.availabilityFailed") };

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
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: t("est.dishDeleteFailed") };

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
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  if (input.name.trim().length < 2) return { ok: false, error: t("est.groupNameShort") };
  if (input.maxSelect < 1) return { ok: false, error: t("est.maxAtLeastOne") };
  if (input.maxSelect < input.minSelect) {
    return { ok: false, error: t("est.maxBelowMin") };
  }
  if (input.isRequired && input.minSelect < 1) {
    return { ok: false, error: t("est.requiredGroupMin") };
  }

  if (!(await ownedItemId(active.restaurantId, input.menuItemId))) {
    return { ok: false, error: t("est.dishNotOnMenu") };
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
    return { ok: false, error: t("est.groupCreateFailed") };
  }

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function deleteOptionGroup(groupId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  if (!(await ownedGroupId(active.restaurantId, groupId))) {
    return { ok: false, error: t("est.groupNotOnMenu") };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("menu_option_groups").delete().eq("id", groupId);

  if (error) return { ok: false, error: t("est.groupDeleteFailed") };

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function createOption(input: {
  groupId: string;
  name: string;
  priceDelta: number;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  if (input.name.trim().length < 1) return { ok: false, error: t("est.optionNameRequired") };
  // Negative is legitimate — "sans viande, −500 F" is a real menu line — so
  // only non-integers are rejected here.
  if (!Number.isInteger(input.priceDelta)) {
    return { ok: false, error: t("est.priceDiffWhole") };
  }

  if (!(await ownedGroupId(active.restaurantId, input.groupId))) {
    return { ok: false, error: t("est.groupNotOnMenu") };
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

  if (error) return { ok: false, error: t("est.optionAddFailed") };

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
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  if (!(await ownsOption(active.restaurantId, optionId))) {
    return { ok: false, error: t("est.optionNotOnMenu") };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("menu_options")
    .update({ is_available: available })
    .eq("id", optionId);

  if (error) return { ok: false, error: t("est.availabilityFailed") };

  revalidatePath("/m/menu");
  return { ok: true };
}

export async function deleteOption(optionId: string): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  if (!(await ownsOption(active.restaurantId, optionId))) {
    return { ok: false, error: t("est.optionNotOnMenu") };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("menu_options").delete().eq("id", optionId);
  if (error) return { ok: false, error: t("est.optionDeleteFailed") };

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
 * register and accept the invitation. Both paths end in a row on this branch's roster, which is what the
 * person doing the inviting expects to see.
 */
export async function inviteStaff(input: {
  email: string;
  role: BranchRole;
  name?: string;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("staff.manage");

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: t("est.emailInvalid") };

  // Only an owner may create another owner. A manager promoting someone above
  // themselves is a privilege-escalation path, not a feature.
  if (input.role === "owner" && active.role !== "owner") {
    return { ok: false, error: t("est.onlyOwnerAddsOwner") };
  }

  const supabase = createAdminClient();

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  let invitationPath = "/login?next=%2Fm";
  if (existingProfile) {
    const { data: already } = await supabase
      .from("restaurant_staff")
      .select("id, status")
      .eq("restaurant_id", active.restaurantId)
      .eq("profile_id", existingProfile.id)
      .maybeSingle();

    if (already) {
      if (already.status === "active") return { ok: false, error: t("est.alreadyWorksHere") };

      // Reinstating a suspended colleague is the same gesture as inviting one.
      const { error } = await supabase
        .from("restaurant_staff")
        .update({ status: "active", role: input.role })
        .eq("id", already.id);

      if (error) return { ok: false, error: t("est.reinstateFailed") };
      revalidatePath("/m/staff");
      return { ok: true, note: t("est.memberReinstated") };
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
      return { ok: false, error: t("est.addToTeamFailed") };
    }
  } else {
    // Single-use, seven-day token. Acceptance also requires the verified
    // invited email, so forwarding this link does not grant staff access.
    const token = randomUUID();
    invitationPath = `/invite/${token}`;
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
      if (error.code === "23505") return { ok: false, error: t("est.inviteOpen") };
      console.error("[manager:inviteStaff]", error.message);
      return { ok: false, error: t("est.inviteSendFailed") };
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
    subject: `Rejoignez ${active.restaurantName} sur Resto237`,
    body: [
      `Bonjour${input.name ? ` ${input.name}` : ""},`,
      "",
      `${profile.name} vous invite à rejoindre l'équipe de ${active.restaurantName} sur Resto237.`,
      "",
      existingProfile
        ? `Connectez-vous avec cette adresse (${email}) pour accéder à votre espace restaurant.`
        : `Ouvrez votre invitation ci-dessous. Connectez-vous ou créez un compte avec cette adresse (${email}), confirmez votre e-mail, puis acceptez l’invitation dans Mon compte.`,
      "",
      "— Resto237",
    ].join("\n"),
    action: { label: existingProfile ? "Accéder à mon espace" : "Ouvrir mon invitation", url: await absoluteUrl(invitationPath) },
    locale: "fr",
  });

  revalidatePath("/m/staff");

  // The record is created either way, so nothing is lost if the send fails —
  // but claiming success for an email that never left would leave the manager
  // waiting for someone who was never told.
  return mail.sent
    ? { ok: true }
    : { ok: true, note: t("est.addedNotEmailed", { reason: mail.reason ?? "", email }) };
}

export async function changeStaffRole(staffId: string, role: BranchRole): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("staff.manage");
  const supabase = createAdminClient();

  const { data: member } = await supabase
    .from("restaurant_staff")
    .select("id, role, profile_id, invited_email")
    .eq("id", staffId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!member) return { ok: false, error: t("est.noSuchMember") };

  if (role === "owner" && active.role !== "owner") {
    return { ok: false, error: t("est.onlyOwnerAppointsOwner") };
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
      return { ok: false, error: t("est.appointAnotherOwnerFirst") };
    }
  }

  const { error } = await supabase.from("restaurant_staff").update({ role }).eq("id", staffId);
  if (error) return { ok: false, error: t("est.roleChangeFailed") };

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
  const t = await getTranslator();
  const { active, profile } = await requireCapability("staff.manage");
  const supabase = createAdminClient();

  const { data: member } = await supabase
    .from("restaurant_staff")
    .select("id, role, profile_id, invited_email")
    .eq("id", staffId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!member) return { ok: false, error: t("est.noSuchMember") };

  if (member.profile_id === profile.id) {
    return { ok: false, error: t("est.cannotRemoveSelf") };
  }

  if (member.role === "owner") {
    const { count } = await supabase
      .from("restaurant_staff")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", active.restaurantId)
      .eq("role", "owner")
      .eq("status", "active");

    if ((count ?? 0) <= 1) return { ok: false, error: t("est.onlyOwner") };
  }

  const { error } = await supabase
    .from("restaurant_staff")
    .update({ status: "suspended" })
    .eq("id", staffId);

  if (error) return { ok: false, error: t("est.suspendFailed") };

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
  const t = await getTranslator();
  const { active } = await requireCapability("staff.manage");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("restaurant_staff")
    .update({ status: "active" })
    .eq("id", staffId)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: t("est.reinstateFailed") };

  revalidatePath("/m/staff");
  return { ok: true };
}

export async function cancelInvite(staffId: string): Promise<ActionResult> {
  const t = await getTranslator();
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

  if (error) return { ok: false, error: t("est.inviteCancelFailed") };

  revalidatePath("/m/staff");
  return { ok: true };
}

/* ── Reservations ──────────────────────────────────────────────────────── */

export async function decideReservation(
  reservationId: string,
  decision: "confirmed" | "cancelled",
  input: { tableId?: string | null; tableIds?: string[]; reason?: string } = {},
): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("reservations.decide");

  /*
    SEVERAL TABLES FOR ONE BOOKING (0068). A big group sits at tables pushed
    together; `tableIds` carries them all, the first one is the booking's
    main table (reservations.table_id, what older screens read). Each table is
    checked like the single one always was, and together they must seat the
    party.
  */
  const tableIds = [...new Set((input.tableIds ?? (input.tableId ? [input.tableId] : [])).filter(Boolean))].slice(0, 12);
  input = { ...input, tableId: tableIds[0] ?? null };

  if (decision === "cancelled" && !input.reason?.trim()) {
    // A refusal with no reason is the thing guests complain about, so the
    // reason is required rather than optional-in-practice.
    return { ok: false, error: t("est.reasonForGuest") };
  }

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, reference, customer_id, guest_name, party_size, reserved_for, duration_min, status, deposit_amount, deposit_paid")
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  const booking = reservation as {
    id: string;
    reference: string;
    customer_id: string | null;
    guest_name: string | null;
    party_size: number;
    reserved_for: string;
    duration_min: number;
    status: CustomerReservationStatus;
    deposit_amount: number | null;
    deposit_paid: boolean | null;
  } | null;

  if (!booking) return { ok: false, error: t("ecu.reservationNotFound") };
  if (!canDecideReservation(booking.status, decision)) {
    return { ok: false, error: t("est.reservationMoved") };
  }

  if (decision === "cancelled" && booking.status === "awaiting_payment") {
    const { data: openAttempt } = await supabase
      .from("payment_attempts")
      .select("id")
      .eq("reservation_id", booking.id)
      .in("status", ["pending", "succeeded"])
      .is("settled_at", null)
      .limit(1)
      .maybeSingle();
    if (openAttempt) {
      return {
        ok: false,
        error: t("est.paymentConfirmingTable"),
      };
    }
  }

  if (decision === "confirmed" && tableIds.length > 0) {
    const access = await fetchTableAccess(active.restaurantId).catch(() => null);
    if (!access) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.accessError"] };
    const chosen = tableIds.map((id) => access.tables.find((table) => table.id === id));
    const seats = chosen.reduce((sum, table) => sum + (table?.capacity ?? 0), 0);

    if (chosen.some((table) => !table || table.planLocked || table.status === "out_of_service") || seats < booking.party_size) {
      return { ok: false, error: t("est.tableUnavailableOrSmall") };
    }

    // Other bookings holding any of these tables, by main table or by link.
    const [{ data: byMain }, links] = await Promise.all([
      supabase
        .from("reservations")
        .select("id, reserved_for, duration_min")
        .eq("restaurant_id", active.restaurantId)
        .in("table_id", tableIds)
        .in("status", ["awaiting_payment", "confirmed", "seated"])
        .neq("id", booking.id),
      supabase
        .from("reservation_tables")
        .select("reservations!inner ( id, reserved_for, duration_min, status, restaurant_id )")
        .in("table_id", tableIds),
    ]);
    const linked = ((links.error ? [] : links.data ?? []) as { reservations: { id: string; reserved_for: string; duration_min: number; status: string; restaurant_id: string } | { id: string; reserved_for: string; duration_min: number; status: string; restaurant_id: string }[] | null }[])
      .map((row) => (Array.isArray(row.reservations) ? row.reservations[0] : row.reservations))
      .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.id !== booking.id &&
        r!.restaurant_id === active.restaurantId && ["awaiting_payment", "confirmed", "seated"].includes(r!.status));

    const startsAt = Date.parse(booking.reserved_for);
    const endsAt = startsAt + Math.max(1, booking.duration_min) * 60_000;
    const conflicts = [...(byMain ?? []), ...linked].some((other) => {
      const otherStart = Date.parse(other.reserved_for as string);
      const otherEnd = otherStart + Math.max(1, Number(other.duration_min)) * 60_000;
      return otherStart < endsAt && otherEnd > startsAt;
    });
    if (conflicts) return { ok: false, error: t("est.tableAlreadyAssigned") };
  }

  /*
    ─────────────────────────────────────────────────────────────────────────
     "YES" IS NOT THE SAME AS "CONFIRMED" WHEN THERE IS A DEPOSIT TO PAY.

     The deposit used to be taken at booking, before this function had run at
     all — so declining a request meant refunding somebody for a table that
     never existed. Nothing is charged up front any more, which moves the
     question here: the restaurant has agreed, but the seat is not paid for.

     `awaiting_payment` is that state. The customer is told to pay, the table
     is held against availability while they do, and settling the payment is
     what promotes the row to `confirmed` (see settlePayment). A booking with
     no deposit due, or one whose deposit a manager already collected on the
     board, goes straight to `confirmed` exactly as before.
    ─────────────────────────────────────────────────────────────────────────
  */
  const depositDue = Number(booking?.deposit_amount ?? 0);
  const needsPayment =
    decision === "confirmed" && depositDue > 0 && booking?.deposit_paid !== true;
  const nextStatus = needsPayment ? "awaiting_payment" : decision;

  const { data: decided, error } = await supabase
    .from("reservations")
    .update({
      status: nextStatus,
      // The table is assigned as soon as the restaurant says yes, including
      // while the deposit is outstanding: it is being held for this guest, and
      // the board needs to show which one.
      table_id: decision === "confirmed" ? (input.tableId ?? null) : null,
      decided_by: profile.email,
      decided_at: new Date().toISOString(),
      decline_reason: decision === "cancelled" ? input.reason!.trim() : null,
    })
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .eq("status", booking.status)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[manager:decideReservation]", error.code ?? "", error.message);
    // 23514 = the status check constraint still carries 0006's six values, so
    // `awaiting_payment` is refused. A different repair from a missing column,
    // and worth naming rather than answering with "could not save".
    if (error.code === "23514" || error.message.includes("status_check")) {
      return {
        ok: false,
        error:
          t("est.migration0039"),
      };
    }
    return { ok: false, error: t("est.decisionSaveFailed") };
  }
  if (!decided) {
    return { ok: false, error: t("est.reservationChangedDeciding") };
  }

  // Every table the booking holds (0068) — tolerated on a database without it.
  {
    const { error: unlinkError } = await supabase.from("reservation_tables").delete().eq("reservation_id", booking.id);
    if (!unlinkError && decision === "confirmed" && tableIds.length > 0) {
      await supabase.from("reservation_tables").insert(tableIds.map((tableId) => ({ reservation_id: booking.id, table_id: tableId })));
    }
  }
  // A declined request frees its slot for whoever is waiting.
  if (decision === "cancelled") await notifyWaitlist(active.restaurantId, booking.reserved_for);

  // The guest hears the verdict — and a refusal must never arrive without the
  // reason the restaurant was forced to give. An approval that still needs
  // paying for says so, because "confirmed" would be a promise the booking has
  // not earned yet.
  if (booking?.customer_id) {
    await notify({
      event: "reservation_decision",
      tone: decision === "cancelled" ? "error" : needsPayment ? "warning" : "success",
      customerId: booking.customer_id,
      href: "/reservations",
      params: {
        reference: booking.reference,
        restaurantName: active.restaurantName,
        status: needsPayment ? "awaiting_payment" : (decision as "confirmed" | "cancelled"),
        amount: needsPayment ? depositDue : undefined,
        reason: decision === "cancelled" ? input.reason?.trim() : undefined,
      },
    });
  }

  revalidatePath("/m/reservations");
  revalidatePath("/reservations");
  revalidatePath("/account");
  return { ok: true };
}

export async function setReservationStatus(
  reservationId: string,
  status: "seated" | "completed" | "no_show",
): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("reservations.seat");
  const supabase = createAdminClient();

  // The linked table is read BEFORE the update so the transition can act on
  // it in the same breath — the reservation and the floor must not drift.
  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, reference, customer_id, status, table_id, reserved_for")
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!reservation) return { ok: false, error: t("est.reservationUpdateFailed") };
  if (!canSetReservationStatus(reservation.status, status)) {
    return { ok: false, error: t("est.reservationBadStage") };
  }
  /*
    FAIR NO-SHOW (2026-09). A no-show keeps the deposit, so it is a verdict
    with money attached — and a party booked for 20:00 is not absent at 20:01.
    The board greys the button until the grace has run; this is the rule for
    a stale tab or a direct POST.
  */
  if (status === "no_show" && !canMarkNoShowYet(reservation.reserved_for as string)) {
    const from = noShowAllowedFrom(reservation.reserved_for as string);
    const at = from
      ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Douala", hour: "2-digit", minute: "2-digit" }).format(from)
      : "";
    return {
      ok: false,
      error: at
        ? t("est.noShowTooEarlyFrom", { minutes: NO_SHOW_GRACE_MIN, at })
        : t("est.noShowTooEarly", { minutes: NO_SHOW_GRACE_MIN }),
    };
  }

  const { data: updated, error } = await supabase
    .from("reservations")
    .update({ status })
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .eq("status", reservation.status)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: t("est.reservationUpdateFailed") };
  if (!updated) return { ok: false, error: t("est.reservationChangedBoard") };

  // SEATING a party marks its table occupied (unless the floor already has
  // it claimed). COMPLETING the meal — or a NO-SHOW, where the table was
  // held and then freed — releases it, with the same open-orders guard as
  // order delivery: a table the kitchen is still cooking for stays taken.
  if (reservation.table_id) {
    if (status === "seated") {
      await supabase
        .from("restaurant_tables")
        .update({ status: "occupied" })
        .eq("id", reservation.table_id)
        .eq("restaurant_id", active.restaurantId)
        .in("status", ["available", "reserved"]);
    } else {
      const { data: table } = await supabase
        .from("restaurant_tables")
        .select("number")
        .eq("id", reservation.table_id)
        .eq("restaurant_id", active.restaurantId)
        .maybeSingle();
      if (table) await releaseTableIfFree(supabase, active.restaurantId, table.number);
    }
  }

  if (reservation.customer_id) {
    await notify({
      event: "reservation_status",
      tone: status === "no_show" ? "error" : status === "completed" ? "success" : "info",
      customerId: reservation.customer_id,
      href: "/reservations",
      params: {
        reference: reservation.reference,
        restaurantName: active.restaurantName,
        status,
      },
    });
  }

  revalidatePath("/m/reservations");
  revalidatePath("/m/tables");
  revalidatePath("/reservations");
  revalidatePath("/account");
  return { ok: true };
}

/**
 * The restaurant withdraws a CONFIRMED booking. Reason required — the
 * customer reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE MONEY MOVES IN POSTGRES, THE PAYOUT IN A SAGA.
 *
 *  restaurant_cancel_reservation (0060) locks the booking, debits the
 *  restaurant wallet by the whole online deposit, writes a pending `refunds`
 *  row and cancels the booking — one transaction, so a crash can never leave
 *  a cancelled booking with the money still on the restaurant's side, or the
 *  reverse. The Mobile Money payout cannot join that transaction; it is
 *  startRefundPayout (idempotent, retried by the reconciler), called here
 *  only to make the happy path immediate.
 *
 *  A deposit collected in cash is not refunded here: no online money moved,
 *  so the function simply cancels.
 *
 *  'insufficient balance' means the restaurant already withdrew the money it
 *  would have to give back. Nothing is cancelled half-way; support settles it.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function cancelConfirmedReservation(
  reservationId: string,
  reason: string,
): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("reservations.decide");

  const why = reason?.trim() ?? "";
  if (!why) return { ok: false, error: t("est.reasonToCustomer") };
  if (why.length > 500) return { ok: false, error: t("est.reasonTooLong") };

  const supabase = createAdminClient();
  const { data: current } = await supabase
    .from("reservations")
    .select("id, status")
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  if (!current) return { ok: false, error: t("ecu.reservationNotFound") };
  if (!canRestaurantCancelReservation(current.status as CustomerReservationStatus)) {
    return {
      ok: false,
      error: t("est.onlyConfirmedCancellable"),
    };
  }

  const { data, error } = await supabase.rpc("restaurant_cancel_reservation", {
    p_reservation_id: reservationId,
    p_restaurant_id: active.restaurantId,
    p_actor: profile.email,
    p_reason: why,
  });

  if (error) {
    const message = error.message ?? "";
    console.error("[manager:cancelConfirmedReservation]", error.code ?? "", message);
    if (message.includes("insufficient balance")) {
      return {
        ok: false,
        error:
          t("est.walletCannotRefund"),
      };
    }
    if (message.includes("reservation_not_cancellable")) {
      return { ok: false, error: t("est.reservationStageChanged") };
    }
    if (message.includes("reason_required")) {
      return { ok: false, error: t("est.reasonToCustomer") };
    }
    // 42883 = the function does not exist: migration 0060 was never applied.
    if (error.code === "42883" || error.code === "PGRST202" || message.includes("restaurant_cancel_reservation")) {
      return {
        ok: false,
        error: t("est.migration0060Cancel"),
      };
    }
    return { ok: false, error: t("est.cancelNotSavedRetry") };
  }

  const result = (data ?? {}) as {
    reference?: string;
    customerId?: string | null;
    tableId?: string | null;
    refundId?: string | null;
    refundAmount?: number;
    alreadyCancelled?: boolean;
  };

  if (!result.alreadyCancelled) {
    // Payout first: it is the customer's money, and the saga is idempotent —
    // a failure here is retried by the reconciler, never lost.
    if (result.refundId) {
      await startRefundPayout(result.refundId).catch((payoutError) =>
        console.error("[manager:cancelConfirmedReservation] payout", payoutError),
      );
    }

    // A table held for this party is free again (same guard as a no-show:
    // a table someone is actually eating at stays taken).
    if (result.tableId) {
      const { data: table } = await supabase
        .from("restaurant_tables")
        .select("number")
        .eq("id", result.tableId)
        .eq("restaurant_id", active.restaurantId)
        .maybeSingle();
      if (table) await releaseTableIfFree(supabase, active.restaurantId, table.number);
    }

    const { data: freed } = await supabase.from("reservations").select("reserved_for").eq("id", reservationId).maybeSingle();
    if (freed?.reserved_for) await notifyWaitlist(active.restaurantId, freed.reserved_for as string);

    if (result.customerId) {
      await notify({
        event: "reservation_decision",
        tone: "error",
        customerId: result.customerId,
        href: "/reservations",
        params: {
          reference: result.reference,
          restaurantName: active.restaurantName,
          status: "cancelled",
          cancelledBy: "restaurant",
          reason: why,
          refundAmount: result.refundAmount && result.refundAmount > 0 ? result.refundAmount : undefined,
          refundTo: result.refundAmount && result.refundAmount > 0 ? "mobile_money" : undefined,
        },
      });
    }

    await writeAudit(profile, {
      action: "reservation.cancelled_by_restaurant",
      entityType: "reservation",
      entityId: reservationId,
      summary: `Reservation ${result.reference ?? reservationId} cancelled by the restaurant: ${why}`,
      metadata: { refundId: result.refundId ?? null, refundAmount: result.refundAmount ?? 0 },
    });
  }

  revalidatePath("/m/reservations");
  revalidatePath("/m/tables");
  revalidatePath("/reservations");
  revalidatePath("/account");
  return {
    ok: true,
    note:
      result.refundAmount && result.refundAmount > 0
        ? t("est.depositRefundedNote", { amount: result.refundAmount.toLocaleString("fr-FR") })
        : undefined,
  };
}

/**
 * How long a booking holds its table (0060) — the restaurant's own sitting
 * length, 15 minutes to 8 hours. Only NEW bookings take it; existing ones
 * keep the duration they were made with.
 */
export async function setReservationDuration(minutes: number): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("settings.manage");

  const value = Math.round(Number(minutes));
  if (!Number.isInteger(value) || value < MIN_RESERVATION_DURATION_MIN || value > MAX_RESERVATION_DURATION_MIN) {
    return {
      ok: false,
      error: t("est.durationRange", { min: MIN_RESERVATION_DURATION_MIN, max: MAX_RESERVATION_DURATION_MIN / 60 }),
    };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("restaurants")
    .update({ reservation_duration_min: value })
    .eq("id", active.restaurantId);

  if (error) {
    if (durationColumnMissing(error)) {
      return {
        ok: false,
        error: t("est.migration0060Duration"),
      };
    }
    console.error("[manager:setReservationDuration]", error.code ?? "", error.message);
    return { ok: false, error: t("est.durationSaveFailed") };
  }

  await writeAudit(profile, {
    action: "restaurant.reservation_duration",
    entityType: "restaurant",
    entityId: active.restaurantId,
    summary: `Reservation sitting length set to ${value} min`,
  });

  revalidatePath("/m/settings");
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
  const t = await getTranslator();
  const { active } = await requireCapability("promotions.manage");

  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,24}$/.test(code)) {
    return { ok: false, error: t("est.promoCodeFormat") };
  }

  if (input.discountType === "percent" && (input.discountValue < 1 || input.discountValue > 100)) {
    return { ok: false, error: t("est.percentRange") };
  }
  if (input.discountValue <= 0) return { ok: false, error: t("est.discountPositive") };

  // An uncapped percentage is how a 20% code becomes a 40 000 F gift on one
  // large group booking. Warned about rather than blocked — it is a legitimate
  // choice, just rarely the intended one.
  const note =
    input.discountType === "percent" && !input.maxDiscount
      ? t("est.promoUncappedNote")
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
    if (error.code === "23505") return { ok: false, error: t("est.promoExists") };
    console.error("[manager:createPromotion]", error.message);
    return { ok: false, error: t("est.promoCreateFailed") };
  }

  revalidatePath("/m/promotions");
  return { ok: true, note };
}

export async function setPromotionActive(id: string, isActive: boolean): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("promotions.manage");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("promotions")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: t("est.promoChangeFailed") };

  revalidatePath("/m/promotions");
  return { ok: true };
}

/* ── Reviews ───────────────────────────────────────────────────────────── */

export async function replyToReview(reviewId: string, reply: string): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("reviews.reply");

  if (reply.trim().length < 5) return { ok: false, error: t("est.replyTooShort") };

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

  if (error) return { ok: false, error: t("est.replyFailed") };
  if ((data ?? []).length === 0) {
    return { ok: false, error: t("est.reviewGone") };
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
  /** "Terrasse", "Salle"… (0068). Undefined leaves it unchanged; "" clears it. */
  zone?: string;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("tables.manage");

  const number = input.number.trim();
  if (!number) return { ok: false, error: t("est.tableNeedsNumber") };
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return { ok: false, error: t("est.capacityMin") };
  }

  const supabase = createAdminClient();
  const access = await fetchTableAccess(active.restaurantId).catch(() => null);
  if (!access) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.accessError"] };
  if (input.id) {
    const table = access.tables.find((table) => table.id === input.id);
    if (!table || table.planLocked) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.frozenError"] };
  } else if (access.limit !== null && access.tables.length >= access.limit) {
    return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.limitError"] };
  }

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
    if (error.code === "23505") return { ok: false, error: t("est.tableNumberInUse") };
    return { ok: false, error: t("est.tableSaveFailed") };
  }

  // The zone is written on its own, so a database without 0068 still saves the table.
  if (input.zone !== undefined) {
    const zone = input.zone.trim().slice(0, 40) || null;
    const { error: zoneError } = await supabase
      .from("restaurant_tables")
      .update({ zone })
      .eq("restaurant_id", active.restaurantId)
      .eq("number", number);
    if (zoneError) console.error("[manager:upsertTable] zone", zoneError.code ?? "", zoneError.message);
  }

  revalidatePath("/m/tables");
  return { ok: true };
}

/**
 * Create SEVERAL identical tables in one go.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A DINING ROOM IS NOT ENTERED ONE TABLE AT A TIME.
 *
 *  The onboarding wizard asked for a number and a capacity, then made the
 *  owner press Add again. And again. A twelve-table restaurant filled that
 *  form twelve times before it could see its own dashboard, which is exactly
 *  where a setup wizard loses people. "I have 12 tables of 4" is one
 *  sentence, and it should be one action.
 *
 *  NUMBERING CONTINUES FROM WHAT IS ALREADY THERE, and skips what is taken.
 *  Restarting at 1 would collide with the tables the wizard's suggested
 *  setup just created, and `restaurant_tables` has a unique index on
 *  (restaurant_id, number) — so a naive loop fails halfway and leaves the
 *  floor half-entered with no explanation of which half.
 *
 *  ONE INSERT, NOT A LOOP OF THEM. A partial failure here is the worst
 *  outcome available: the owner cannot tell what landed, and re-running
 *  duplicates whatever did. A single statement either takes or does not.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function bulkCreateTables(input: {
  count: number;
  capacity: number;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("tables.manage");

  if (!Number.isInteger(input.count) || input.count < 1) {
    return { ok: false, error: t("est.bulkCount") };
  }
  // A ceiling, because this writes one row per unit and the field is free
  // text: a mistyped "100" is a slow afternoon, a mistyped "100000" is an
  // outage. No real dining room in scope needs more than this in one go.
  if (input.count > 100) {
    return { ok: false, error: t("est.bulkMax") };
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return { ok: false, error: t("est.capacityMin") };
  }

  const supabase = createAdminClient();

  const access = await fetchTableAccess(active.restaurantId).catch(() => null);
  if (!access) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.accessError"] };
  if (access.limit !== null && access.tables.length + input.count > access.limit) {
    return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.limitError"] };
  }
  const taken = new Set(access.tables.map((table) => String(table.number).trim()));

  // Walk upwards from 1, skipping every number already in use, until we have
  // `count` free ones. The bound stops a floor numbered "A1".."A9" (nothing
  // numeric taken, so no skipping) from ever spinning.
  const numbers: string[] = [];
  for (let n = 1; numbers.length < input.count && n <= input.count + taken.size + 1; n++) {
    if (!taken.has(String(n))) numbers.push(String(n));
  }

  const { error } = await supabase.from("restaurant_tables").insert(
    numbers.map((number) => ({
      restaurant_id: active.restaurantId,
      number,
      capacity: input.capacity,
    })),
  );

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: t("est.bulkNumbersInUse") };
    }
    console.error("[manager:bulkCreateTables] insert", error.message);
    return { ok: false, error: t("est.tablesCreateFailed") };
  }

  revalidatePath("/m/tables");
  revalidatePath("/m/setup");
  return { ok: true };
}

export async function setTableStatus(
  id: string,
  status: "available" | "occupied" | "reserved" | "out_of_service",
): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("reservations.seat");
  const supabase = createAdminClient();
  const access = await fetchTableAccess(active.restaurantId).catch(() => null);
  if (!access) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.accessError"] };
  const table = access.tables.find((table) => table.id === id);
  if (!table || table.planLocked) return { ok: false, error: DICTIONARIES[await getLocale()]["tbl.frozenError"] };

  const { error } = await supabase
    .from("restaurant_tables")
    .update({ status })
    .eq("id", id)
    .eq("restaurant_id", active.restaurantId);

  if (error) return { ok: false, error: t("est.tableUpdateFailed") };

  revalidatePath("/m/tables");
  return { ok: true };
}

/**
 * Mark the first-login setup wizard as finished.
 *
 * Gated on `menu.view` on purpose: EVERY branch role holds it, and the
 * dashboard redirects whoever opens /m first — waiter or owner — so the
 * action that unlocks the dashboard must not exclude any of them.
 */
export async function completeSetup(): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.view");
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("restaurants")
    .update({ setup_done_at: new Date().toISOString() })
    .eq("id", active.restaurantId);

  if (error) return { ok: false, error: t("est.setupFailed") };

  revalidatePath("/m");
  revalidatePath("/m/setup");
  return { ok: true };
}

/* ── Delivery mode (migration 0032) ───────────────────────────────────── */

/**
 * Does this restaurant deliver at all, and if so, who carries the food?
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TWO QUESTIONS, AND THE FIRST ONE USED TO BE ASSUMED.
 *
 *  Onboarding only ever asked "own riders, or the platform?" — which quietly
 *  takes for granted that the restaurant delivers. Plenty do not. A grill
 *  with two staff and no bike was forced to pick one of two delivery
 *  arrangements it could not honour, and then appeared in the directory
 *  promising delivery to every customer who filtered for it.
 *
 *  `offersDelivery` is therefore its own answer, written to `accepts_delivery`
 *  — the column the public directory, the restaurant page and checkout have
 *  always read. Saying no here removes the promise everywhere at once, and
 *  the restaurant can turn it back on from their dashboard the day they hire
 *  a rider.
 *
 *  `hasOwnDelivery` is only meaningful when the answer is yes, so it is
 *  optional and simply left untouched when it is not supplied. Writing a
 *  default would silently re-answer a question nobody asked.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function setDeliveryOffering(input: {
  offersDelivery: boolean;
  /** Own riders (true) or platform-managed (false). Ignored when not delivering. */
  hasOwnDelivery?: boolean;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("profile.edit");
  const supabase = createAdminClient();

  const patch: Record<string, boolean> = { accepts_delivery: input.offersDelivery };
  if (input.offersDelivery && input.hasOwnDelivery !== undefined) {
    patch.has_own_delivery = input.hasOwnDelivery;
  }

  const { error } = await supabase
    .from("restaurants")
    .update(patch)
    .eq("id", active.restaurantId);

  if (error) {
    console.error("[manager:setDeliveryOffering]", error.message);
    return { ok: false, error: t("est.deliverySaveFailed") };
  }

  await writeAudit(profile, {
    action: "restaurant.delivery_mode",
    entityType: "restaurant",
    entityId: active.restaurantId,
    summary: !input.offersDelivery
      ? `${active.restaurantName}: delivery off`
      : input.hasOwnDelivery
        ? `${active.restaurantName}: own delivery riders`
        : `${active.restaurantName}: platform delivery`,
  });

  revalidatePath("/m/profile");
  revalidatePath("/m/settings");
  revalidatePath("/m/setup");
  revalidatePath("/m");
  // The public directory and the restaurant's own page both read
  // accepts_delivery — a stale cache would keep offering delivery the
  // kitchen just switched off.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The delivery fee band this restaurant works within (migration 0035).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE FEE IS STILL A QUOTE. THIS IS THE PROMISE AROUND IT.
 *
 *  §14.3 keeps the number itself in the restaurant's hands, set at
 *  confirmation against the real quartier. What it never gave the customer
 *  was any way to budget: the checkout said "to be confirmed", and the first
 *  real figure arrived attached to an order they had already placed.
 *
 *  min/max are advertised on the restaurant page and at checkout, and the
 *  confirmation dialog is CONSTRAINED by them. Advertising a band and then
 *  letting the quote land outside it would be worse than saying nothing,
 *  because the customer believed it.
 *
 *  max = 0 means "no ceiling declared" and is deliberately allowed. A
 *  restaurant delivering across an unbounded area must be able to say so
 *  rather than be pushed into a number it will have to break.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function setDeliveryFeeRange(input: {
  min: number;
  max: number;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("profile.edit");

  const min = Math.round(input.min);
  const max = Math.round(input.max);

  if (!Number.isInteger(min) || min < 0) {
    return { ok: false, error: t("est.minFeeInvalid") };
  }
  if (!Number.isInteger(max) || max < 0) {
    return { ok: false, error: t("est.maxFeeInvalid") };
  }
  // Mirrors the database constraint, so the caller gets a sentence rather
  // than a Postgres error code.
  if (max !== 0 && max < min) {
    return { ok: false, error: t("est.maxFeeBelowMin") };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("restaurants")
    .update({ min_delivery_fee: min, max_delivery_fee: max })
    .eq("id", active.restaurantId);

  if (error) {
    console.error("[manager:setDeliveryFeeRange]", error.message);
    return {
      ok: false,
      // Named explicitly: this is the one failure here that is a missing
      // migration rather than bad input, and "could not save" sends whoever
      // reads it looking in the wrong place.
      error: error.message.includes("min_delivery_fee")
        ? t("est.migration0035Fees")
        : t("est.feeRangeSaveFailed"),
    };
  }

  await writeAudit(profile, {
    action: "restaurant.delivery_fee_range",
    entityType: "restaurant",
    entityId: active.restaurantId,
    summary: `${active.restaurantName}: delivery fee ${min.toLocaleString("fr-CM")}–${
      max === 0 ? "∞" : max.toLocaleString("fr-CM")
    } FCFA`,
  });

  revalidatePath("/m/profile");
  revalidatePath("/m/setup");
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ── Default opening hours (onboarding) ──────────────────────────────── */

/**
 * Set the default opening hours for a brand-new restaurant: Mon–Sat
 * 10:00–22:00, Sunday closed. Called during the setup wizard so the
 * restaurant's public page shows realistic hours from the start.
 *
 * Uses the same saveOpeningHours-style upsert, but with a simpler
 * interface since this is a fixed default.
 */
export async function setDefaultOpeningHours(): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.view");
  const supabase = createAdminClient();

  // Mon(1)–Sat(6): 10:00–22:00, Sun(0): closed
  const hours = [
    { weekday: 0, opens_at: null as string | null, closes_at: null as string | null },
    { weekday: 1, opens_at: "10:00", closes_at: "22:00" },
    { weekday: 2, opens_at: "10:00", closes_at: "22:00" },
    { weekday: 3, opens_at: "10:00", closes_at: "22:00" },
    { weekday: 4, opens_at: "10:00", closes_at: "22:00" },
    { weekday: 5, opens_at: "10:00", closes_at: "22:00" },
    { weekday: 6, opens_at: "10:00", closes_at: "22:00" },
  ];

  const { error } = await supabase.from("restaurant_hours").upsert(
    hours.map((h) => ({
      restaurant_id: active.restaurantId,
      weekday: h.weekday,
      opens_at: h.opens_at,
      closes_at: h.closes_at,
    })),
    { onConflict: "restaurant_id,weekday" },
  );

  if (error) {
    console.error("[manager:setDefaultOpeningHours]", error.message);
    return { ok: false, error: t("est.hoursSaveFailed") };
  }

  revalidatePath("/m/profile");
  revalidatePath("/m/setup");
  return { ok: true };
}

/* ── Reservation deposits (migration 0025) ────────────────────────────── */

/**
 * Set the reservation fee this restaurant asks to hold a table (migrations
 * 0031 and 0038). Three kinds:
 *
 *   fixed    — a fixed FCFA amount (`deposit_amount`). The customer pays it
 *              ONLINE at booking (Mobile Money); it is deducted from their
 *              final bill.
 *   per_seat — an FCFA amount PER GUEST, multiplied by the party size. Paid
 *              online and deducted the same way. It exists because a flat fee
 *              prices the wrong thing: holding a table of ten empty costs five
 *              times what an empty two-top costs, and one number cannot be
 *              both large enough to deter the first and small enough not to
 *              deter the second.
 *   percent  — a percentage of the customer's final bill (the number in
 *              `deposit_amount` is then a %). NOT charged online — the bill is
 *              unknown at booking — so the booking shows "X% of your bill" and
 *              the board collects it against the real bill.
 *
 * Amount 0 = no fee, whatever the type.
 */
export async function setRestaurantDeposit(
  amount: number,
  options: { type?: DepositType } = {},
): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("finance.manage");

  const type = normaliseDepositType(options.type);
  const value = Math.round(amount);
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, error: t("est.amountNonNegative") };
  }
  if (type === "percent" && (value < 1 || value > 100)) {
    return { ok: false, error: t("est.percentFeeRange") };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("restaurants")
    .update({ deposit_amount: value, deposit_type: type })
    .eq("id", active.restaurantId);

  if (error) {
    /*
      "Could not save the deposit." was the whole message, for every cause.

      It is the last step of onboarding, so whoever hits it is a brand-new
      restaurant with nothing else to try — and the overwhelmingly likely
      cause is that `deposit_type` does not exist because migration 0031 (or
      its catch-up, 0033) was never run against this database. A sentence
      that names the migration turns a dead end into a two-minute fix; the
      real Postgres message goes to the server log either way.
    */
    console.error("[manager:setRestaurantDeposit]", error.code ?? "", error.message);

    const missingColumn =
      error.code === "42703" ||
      error.message.includes("deposit_type") ||
      error.message.includes("deposit_amount");

    // A per-seat fee also fails on a database that HAS the column but still
    // carries 0031's two-value check constraint, which is a different repair
    // from a missing column and the same migration fixes both.
    const rejectedValue = error.code === "23514" || error.message.includes("deposit_type_check");

    return {
      ok: false,
      error:
        missingColumn || rejectedValue
          ? t("est.migration0038")
          : t("est.depositSaveFailed", { detail: error.message }),
    };
  }

  await writeAudit(profile, {
    action: "restaurant.deposit_set",
    entityType: "restaurant",
    entityId: active.restaurantId,
    summary:
      type === "percent"
        ? `Set ${active.restaurantName} reservation deposit to ${value}% of the bill`
        : `Set ${active.restaurantName} reservation deposit to ${value.toLocaleString("fr-CM")} FCFA`,
  });

  revalidatePath("/m/reservations");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Mark a booking's acompte as collected — the moment the money is actually
 * received, the restaurant's wallet is credited (migration 0024).
 *
 * The manager is not an admin, so the credit happens through the same RPC the
 * admin action uses, scoped to their own branch by the reservation lookup.
 *
 * Two kinds of deposit (migration 0031):
 *   · fixed/per-seat — the customer normally pays online after acceptance;
 *     this action is only the fallback for cash that was actually received.
 *   · percent — the customer pays nothing online; the deposit is a percentage
 *     of their actual bill, which is only known once they are eating. The
 *     manager enters the bill total and `amount = bill × pct / 100`.
 */
export async function collectReservationDeposit(
  reservationId: string,
  billTotal?: number,
): Promise<ActionResult> {
  const t = await getTranslator();
  // Taking a deposit at the counter is a cashier's job (payments.collect);
  // finance.manage stays for withdrawals and deposit policy.
  const { active, profile } = await requireCapability("payments.collect");
  const supabase = createAdminClient();

  const { data: reservation } = await supabase
    .from("reservations")
    .select("id, reference, customer_id, deposit_amount, deposit_percent, deposit_paid, status")
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .maybeSingle();

  const row = reservation as {
    id: string;
    reference: string;
    customer_id: string | null;
    deposit_amount: number;
    deposit_percent: number;
    deposit_paid: boolean;
    status: CustomerReservationStatus;
  } | null;

  if (!row) return { ok: false, error: t("ecu.reservationNotFound") };
  if (row.deposit_paid) return { ok: false, error: t("est.depositAlreadyCollected") };

  /*
    ONLY THE CUSTOMER PAYS AN ONLINE DEPOSIT (payment first, 2026-09).

    A fixed or per-seat deposit is paid from the customer's own phone and
    confirms the booking the moment it lands. Recording it here as cash
    confirmed tables with no money received online — the restaurant stood in
    for a step only the customer may take. Only a percentage deposit, a share
    of a bill that exists once the party is eating, is collected on site.
  */
  if (Number(row.deposit_percent ?? 0) <= 0) {
    return {
      ok: false,
      error: t("est.depositPaidOnline"),
    };
  }
  if (!canManagerCollectReservationDeposit({
    status: row.status,
    depositPercent: Number(row.deposit_percent ?? 0),
    depositPaid: row.deposit_paid,
  })) {
    return {
      ok: false,
      error:
        row.deposit_percent > 0
          ? t("est.percentDepositDuringService")
          : t("est.customerOwnsPayment"),
    };
  }

  if (row.deposit_percent <= 0) {
    const { data: openAttempt } = await supabase
      .from("payment_attempts")
      .select("id")
      .eq("reservation_id", row.id)
      .in("status", ["pending", "succeeded"])
      .is("settled_at", null)
      .limit(1)
      .maybeSingle();
    if (openAttempt) {
      return {
        ok: false,
        error: t("est.momoConfirmingNoCash"),
      };
    }
  }

  // Percent bookings carry no fixed amount — the percentage of the bill the
  // manager is entering is what must be collected.
  let amount = row.deposit_amount;
  if (row.deposit_percent > 0) {
    if (billTotal === undefined) return { ok: false, error: t("est.billTotalRequired") };
    const bill = Math.round(billTotal);
    if (!Number.isInteger(bill) || bill <= 0) return { ok: false, error: t("est.billTotalPositive") };
    amount = Math.round((bill * row.deposit_percent) / 100);
    if (amount <= 0) return { ok: false, error: t("est.depositZero") };
  }

  if (amount <= 0) return { ok: false, error: t("est.noDeposit") };

  /*
   * Claim the unpaid row before moving money. Two cashiers tapping together
   * cannot both credit the wallet; only the compare-and-swap winner proceeds.
   * A fixed cash fallback also performs the awaiting_payment → confirmed
   * transition in that same claim.
   */
  const isOnlineFallback = row.deposit_percent <= 0;
  const { data: claimed, error: claimError } = await supabase
    .from("reservations")
    .update(
      isOnlineFallback
        ? { deposit_paid: true, status: "confirmed" }
        : { deposit_paid: true },
    )
    .eq("id", reservationId)
    .eq("restaurant_id", active.restaurantId)
    .eq("status", row.status)
    .eq("deposit_paid", false)
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    return { ok: false, error: t("est.bookingChangedDeposit") };
  }

  const { error: creditError } = await supabase.rpc("wallet_credit", {
    p_restaurant_id: active.restaurantId,
    p_amount: amount,
    p_kind: "deposit",
    p_note: `Acompte ${row.reference}`,
    p_reference: row.reference,
  });

  if (creditError) {
    console.error("[manager:collectReservationDeposit]", creditError.message);
    await supabase
      .from("reservations")
      .update(
        isOnlineFallback
          ? { deposit_paid: false, status: "awaiting_payment" }
          : { deposit_paid: false },
      )
      .eq("id", reservationId)
      .eq("deposit_paid", true)
      .eq("status", isOnlineFallback ? "confirmed" : row.status);
    return { ok: false, error: t("est.walletCreditFailed") };
  }

  if (isOnlineFallback && row.customer_id) {
    await notify({
      event: "reservation_decision",
      tone: "success",
      customerId: row.customer_id,
      href: "/reservations",
      params: {
        reference: row.reference,
        restaurantName: active.restaurantName,
        status: "confirmed",
      },
    });
  }

  await writeAudit(profile, {
    action: "reservation.deposit_collected",
    entityType: "reservation",
    entityId: reservationId,
    summary: `Collected ${amount.toLocaleString("fr-CM")} FCFA deposit for ${row.reference}`,
  });

  revalidatePath("/m/reservations");
  revalidatePath("/m/wallet");
  revalidatePath("/reservations");
  revalidatePath("/account");
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
  /** The advertised delivery band (migration 0035). 0 = not declared. */
  minDeliveryFee?: number;
  maxDeliveryFee?: number;
  acceptsDelivery?: boolean;
  acceptsPickup?: boolean;
}): Promise<ActionResult> {
  const t = await getTranslator();
  const { active, profile } = await requireCapability("profile.edit");

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (input.name.trim().length < 2) return { ok: false, error: t("est.restaurantNameShort") };
    patch.name = input.name.trim();
  }
  // Distinguishes two locations of the same restaurant ("Akwa", "Bonapriso"),
  // so it is never empty — a blank one leaves two identical rows in the branch
  // switcher with no way to tell which is which.
  if (input.branchLabel !== undefined) {
    const label = input.branchLabel.trim();
    if (label.length < 2) return { ok: false, error: t("est.branchNameShort") };
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

  /*
    The band is validated TOGETHER, because neither number means anything
    alone. The database carries the same rule as a check constraint; this is
    here so a manager gets a sentence rather than a constraint name.
  */
  if (input.minDeliveryFee !== undefined || input.maxDeliveryFee !== undefined) {
    const min = Math.round(input.minDeliveryFee ?? 0);
    const max = Math.round(input.maxDeliveryFee ?? 0);
    if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < 0) {
      return { ok: false, error: t("est.deliveryFeesWhole") };
    }
    // max = 0 is the "no ceiling declared" escape hatch and stays legal.
    if (max !== 0 && max < min) {
      return { ok: false, error: t("est.maxDeliveryBelowMin") };
    }
    patch.min_delivery_fee = min;
    patch.max_delivery_fee = max;
  }

  if (input.acceptsDelivery !== undefined) patch.accepts_delivery = input.acceptsDelivery;
  if (input.acceptsPickup !== undefined) patch.accepts_pickup = input.acceptsPickup;

  // The slug is deliberately absent. Changing it breaks every link a
  // restaurant has ever shared, and there is no redirect table yet.

  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = createAdminClient();
  const { error } = await supabase.from("restaurants").update(patch).eq("id", active.restaurantId);

  if (error) {
    console.error("[manager:updateRestaurantProfile]", error.code ?? "", error.message);
    // 42703 = unknown column, which here means migration 0035 has not run.
    // Named, because "could not save the changes" sends whoever reads it
    // looking at their own input instead of at the database.
    return {
      ok: false,
      error:
        error.code === "42703"
          ? t("est.migration0035Column")
          : t("est.changesSaveFailed"),
    };
  }

  await writeAudit(profile, {
    action: "restaurant.profile_updated",
    entityType: "restaurant",
    entityId: active.restaurantId,
    summary: `Updated: ${Object.keys(patch).join(", ")}`,
  });

  revalidatePath("/m", "layout");
  // The logo, the description and the delivery band all render on the public
  // restaurant page and in the directory — a stale cache there would show
  // customers a promise the restaurant has just changed.
  revalidatePath("/", "layout");
  return { ok: true };
}
