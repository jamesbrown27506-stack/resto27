/**
 * "Commander à nouveau": turn a past order's lines back into basket lines,
 * against the menu AS IT IS TODAY.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  AN ORDER LINE DOES NOT REMEMBER ITS OPTION IDS.
 *
 *  order_items snapshots `options_label` ("Grande · Sauce piment") — the
 *  human string printed on the ticket (§12) — not the option ids. So options
 *  are matched back BY NAME inside that dish's current option groups, and
 *  prices always come from today's menu, never from the old order: the basket
 *  is a suggestion, and placeOrder re-derives every franc anyway.
 *
 *  A line is SKIPPED (and named, so the customer is told) when it cannot be
 *  rebuilt faithfully: the dish is gone, unavailable or sold out; one of its
 *  options no longer exists; or a required choice can no longer be satisfied.
 *  Rebuilding it with a guessed option is exactly the silent default §3
 *  forbids — the customer can add it again by hand.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pure: no database, no React — the server action feeds it the menu and the
 * tests feed it fixtures.
 */

export interface ReorderSourceLine {
  menuItemId: string | null;
  /** The dish name as ordered — used to name a skipped line. */
  name: string;
  quantity: number;
  /** `options_label` ("A · B") or the option names as an array. */
  options?: string | string[] | null;
  notes?: string | null;
}

export interface ReorderMenuOption {
  id: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
}

export interface ReorderMenuGroup {
  id: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  options: ReorderMenuOption[];
}

export interface ReorderMenuItem {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  prepMinutes: number;
  trackStock: boolean;
  stockQuantity: number | null;
  optionGroups: ReorderMenuGroup[];
}

/** Shaped like CartLine minus the restaurant fields the caller adds. */
export interface RebuiltLine {
  menuItemId: string;
  name: string;
  basePrice: number;
  quantity: number;
  options: { groupId: string; groupName: string; optionId: string; optionName: string; priceDelta: number }[];
  notes: string | null;
  prepMinutes: number;
}

const MAX_QTY = 50;

function norm(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function optionNames(options: ReorderSourceLine["options"]): string[] {
  if (!options) return [];
  const list = Array.isArray(options) ? options : options.split(" · ");
  return list.map((name) => name.trim()).filter(Boolean);
}

export function rebuildReorderLines(
  source: ReorderSourceLine[],
  menu: ReorderMenuItem[],
): { lines: RebuiltLine[]; skipped: string[] } {
  const byId = new Map(menu.map((item) => [item.id, item]));
  const lines: RebuiltLine[] = [];
  const skipped: string[] = [];

  for (const line of source) {
    const item = line.menuItemId ? byId.get(line.menuItemId) : undefined;
    const soldOut = item?.trackStock && item.stockQuantity !== null && item.stockQuantity <= 0;
    if (!item || !item.isAvailable || soldOut) {
      skipped.push(line.name);
      continue;
    }

    // Match each ordered option name to an available option of THIS dish,
    // never reusing one (two groups can hold options with the same name).
    const chosen: RebuiltLine["options"] = [];
    let faithful = true;
    for (const wanted of optionNames(line.options)) {
      let found: RebuiltLine["options"][number] | null = null;
      for (const group of item.optionGroups) {
        const option = group.options.find(
          (o) => o.isAvailable && norm(o.name) === norm(wanted) && !chosen.some((c) => c.optionId === o.id),
        );
        if (option) {
          found = { groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, priceDelta: option.priceDelta };
          break;
        }
      }
      if (!found) {
        faithful = false;
        break;
      }
      chosen.push(found);
    }

    // Today's rules for this dish must still be met by the old choices.
    if (faithful) {
      for (const group of item.optionGroups) {
        const count = chosen.filter((c) => c.groupId === group.id).length;
        if (count > Math.max(1, group.maxSelect)) faithful = false;
        if (group.isRequired && count < Math.max(1, group.minSelect)) faithful = false;
      }
    }
    if (!faithful) {
      skipped.push(line.name);
      continue;
    }

    let quantity = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(line.quantity) || 1)));
    if (item.trackStock && item.stockQuantity !== null) quantity = Math.min(quantity, item.stockQuantity);

    lines.push({
      menuItemId: item.id,
      name: item.name,
      basePrice: item.price,
      quantity,
      options: chosen,
      notes: line.notes?.trim() || null,
      prepMinutes: item.prepMinutes,
    });
  }

  return { lines, skipped };
}
