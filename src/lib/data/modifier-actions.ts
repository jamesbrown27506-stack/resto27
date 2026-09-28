"use server";

import { revalidatePath } from "next/cache";
import { getTranslator } from "@/lib/i18n/locale-server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import type { ActionResult } from "./admin-actions";
import { templateProblem, type OptionTemplate } from "@/lib/menu/presets";

/**
 * Editing an existing option group.
 *
 * Creation and deletion already live in manager-actions.ts; renaming a group
 * and moving its min/max did not, and the screen needs it — "Taille" opened
 * with max 1 and later gaining a second size is an ordinary Tuesday, and the
 * alternative (delete the group, lose its options, retype them) is not an
 * edit, it is a data loss with extra steps.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  menu_option_groups HAS NO restaurant_id.
 *
 *  So the usual `.eq("restaurant_id", active.restaurantId)` has nothing to
 *  bind to, and with the service-role key bypassing RLS an id posted straight
 *  at this endpoint would otherwise edit any restaurant's group. Ownership is
 *  therefore established by joining up to menu_items BEFORE the update, the
 *  same hop deleteOptionGroup makes. Never shorten this to a bare
 *  `.update().eq("id", groupId)`.
 * ─────────────────────────────────────────────────────────────────────────
 */

async function ownsGroup(restaurantId: string, groupId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("menu_option_groups")
    .select("id, menu_items!inner(restaurant_id)")
    .eq("id", groupId)
    .maybeSingle();

  const row = data as unknown as { id: string; menu_items: { restaurant_id: string } } | null;
  return row?.menu_items.restaurant_id === restaurantId;
}

export async function updateOptionGroup(
  groupId: string,
  input: { name: string; minSelect: number; maxSelect: number; isRequired: boolean },
): Promise<ActionResult> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  // The same four rules createOptionGroup enforces. Duplicated on purpose: a
  // group that could only be born valid and then edited into "min 3, max 1"
  // would be a checkout nobody can complete.
  if (input.name.trim().length < 2) return { ok: false, error: t("est.groupNameShort") };
  if (input.maxSelect < 1) return { ok: false, error: t("est.maxAtLeastOne") };
  if (input.maxSelect < input.minSelect) {
    return { ok: false, error: t("est.maxBelowMin") };
  }
  if (input.isRequired && input.minSelect < 1) {
    return { ok: false, error: t("est.requiredGroupMin") };
  }

  if (!(await ownsGroup(active.restaurantId, groupId))) {
    return { ok: false, error: t("est.groupNotOnMenu") };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("menu_option_groups")
    .update({
      name: input.name.trim(),
      min_select: input.minSelect,
      max_select: input.maxSelect,
      is_required: input.isRequired,
    })
    .eq("id", groupId);

  if (error) {
    console.error("[modifiers:updateOptionGroup]", error.message);
    return { ok: false, error: t("est.groupSaveFailed") };
  }

  revalidatePath("/m/menu");
  // The screen that fired this is the nested one; revalidating only /m/menu
  // would leave the page the manager is looking at showing the old name.
  revalidatePath("/m/menu/[id]/modifiers", "page");
  return { ok: true };
}

/**
 * One option list, applied to many dishes at once.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  "Accompagnement: water fufu · garri · plantain" is the same list on a
 *  dozen dishes. Typed dish by dish it never gets typed at all, so the menu
 *  screen prepares it once (from the Cameroonian library in lib/menu/presets,
 *  or copied from a dish that already has it) and this writes it onto every
 *  dish ticked.
 *
 *  `replace`: a dish that already has a list of the SAME NAME gets the new
 *  one instead of a duplicate — which is also how a restaurant edits the
 *  list everywhere later: change it once, apply it again.
 *
 *  Ownership is proven for every dish (menu_items.restaurant_id), since the
 *  groups themselves carry no restaurant id — see the note above.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function applyOptionTemplate(input: {
  template: OptionTemplate;
  menuItemIds: string[];
  replace: boolean;
}): Promise<ActionResult & { count?: number }> {
  const t = await getTranslator();
  const { active } = await requireCapability("menu.edit");

  const template: OptionTemplate = {
    name: String(input.template?.name ?? "").trim().slice(0, 60),
    minSelect: Math.max(0, Math.round(Number(input.template?.minSelect) || 0)),
    maxSelect: Math.max(0, Math.round(Number(input.template?.maxSelect) || 0)),
    isRequired: Boolean(input.template?.isRequired),
    options: (input.template?.options ?? []).map((o) => ({
      name: String(o.name ?? "").trim().slice(0, 60),
      priceDelta: Number(o.priceDelta),
    })),
  };
  const problem = templateProblem(template);
  if (problem === "name") return { ok: false, error: t("est.groupNameShort") };
  if (problem === "range") return { ok: false, error: t("est.maxBelowMin") };
  if (problem === "price") return { ok: false, error: t("est.priceDiffWhole") };
  if (problem) return { ok: false, error: t("est.optionNameRequired") };

  const ids = [...new Set((input.menuItemIds ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 300);
  if (ids.length === 0) return { ok: false, error: t("est.selectDishes") };

  const supabase = createAdminClient();
  const { data: owned } = await supabase
    .from("menu_items")
    .select("id")
    .eq("restaurant_id", active.restaurantId)
    .in("id", ids);
  const itemIds = ((owned ?? []) as { id: string }[]).map((row) => row.id);
  if (itemIds.length === 0) return { ok: false, error: t("est.dishNotOnMenu") };

  if (input.replace) {
    const { error: removeError } = await supabase
      .from("menu_option_groups")
      .delete()
      .in("menu_item_id", itemIds)
      // ilike without wildcards = a case-insensitive exact match; the name's
      // own % and _ are escaped so they are not read as wildcards.
      .ilike("name", template.name.replace(/[%_\\]/g, "\\$&"));
    if (removeError) console.error("[modifiers:applyOptionTemplate] replace", removeError.message);
  }

  // Each new list goes after the dish's existing ones.
  const { data: existing } = await supabase
    .from("menu_option_groups")
    .select("menu_item_id, sort_order")
    .in("menu_item_id", itemIds);
  const lastSort = new Map<string, number>();
  for (const row of (existing ?? []) as { menu_item_id: string; sort_order: number }[]) {
    lastSort.set(row.menu_item_id, Math.max(lastSort.get(row.menu_item_id) ?? 0, row.sort_order ?? 0));
  }

  const { data: groups, error: groupError } = await supabase
    .from("menu_option_groups")
    .insert(itemIds.map((menuItemId) => ({
      menu_item_id: menuItemId,
      name: template.name,
      min_select: template.minSelect,
      max_select: template.maxSelect,
      is_required: template.isRequired,
      sort_order: (lastSort.get(menuItemId) ?? 0) + 1,
    })))
    .select("id");
  if (groupError || !groups) {
    console.error("[modifiers:applyOptionTemplate] groups", groupError?.message);
    return { ok: false, error: t("est.groupCreateFailed") };
  }

  const { error: optionError } = await supabase.from("menu_options").insert(
    (groups as { id: string }[]).flatMap((group) =>
      template.options.map((option, index) => ({
        group_id: group.id,
        name: option.name,
        price_delta: option.priceDelta,
        sort_order: index + 1,
      })),
    ),
  );
  if (optionError) {
    console.error("[modifiers:applyOptionTemplate] options", optionError.message);
    // A group without options would block checkout on a required choice.
    await supabase.from("menu_option_groups").delete().in("id", (groups as { id: string }[]).map((g) => g.id));
    return { ok: false, error: t("est.optionAddFailed") };
  }

  revalidatePath("/m/menu");
  return { ok: true, count: itemIds.length };
}
