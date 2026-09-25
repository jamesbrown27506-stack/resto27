"use server";

import { revalidatePath } from "next/cache";
import { getTranslator } from "@/lib/i18n/locale-server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/branch";
import type { ActionResult } from "./admin-actions";

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
