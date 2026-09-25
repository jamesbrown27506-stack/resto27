"use server";

import { rateLimit } from "@/lib/rate-limit";
import { rebuildReorderLines, type RebuiltLine, type ReorderSourceLine } from "@/lib/orders/reorder";
import { fetchMenuSections, fetchPublicRestaurantBySlug } from "./public";

export type PrepareReorderResult =
  | {
      ok: true;
      restaurant: { id: string; name: string; slug: string };
      lines: RebuiltLine[];
      /** Dish names that could not be rebuilt — the caller says so. */
      skipped: string[];
    }
  | { ok: false; reason: "unavailable" | "rateLimited" | "failed" };

/**
 * Rebuild a past order's basket against today's public menu.
 *
 * READ-ONLY and public by nature: it reads exactly what the restaurant page
 * shows anyone (active restaurant, visible categories) and writes nothing —
 * the basket lives in the customer's localStorage and placeOrder re-validates
 * every line and price. So it needs no session; the order-detail page that
 * renders the button has already scoped the lines to their owner.
 *
 * The input is still untrusted: bounded, shape-checked, rate limited.
 */
export async function prepareReorder(input: {
  restaurantSlug: string;
  lines: ReorderSourceLine[];
}): Promise<PrepareReorderResult> {
  const limited = await rateLimit({ key: "reorder:prepare", limit: 20, windowMs: 10 * 60_000 });
  if (!limited.ok) return { ok: false, reason: "rateLimited" };

  const slug = typeof input?.restaurantSlug === "string" ? input.restaurantSlug.slice(0, 120) : "";
  if (!slug || !Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 60) {
    return { ok: false, reason: "failed" };
  }
  const lines: ReorderSourceLine[] = input.lines.map((line) => ({
    menuItemId: typeof line?.menuItemId === "string" ? line.menuItemId : null,
    name: String(line?.name ?? "").slice(0, 120),
    quantity: Number(line?.quantity) || 1,
    options: Array.isArray(line?.options)
      ? line.options.map((o) => String(o).slice(0, 120)).slice(0, 20)
      : typeof line?.options === "string" ? line.options.slice(0, 600) : null,
    notes: typeof line?.notes === "string" ? line.notes.slice(0, 300) : null,
  }));

  try {
    const restaurant = await fetchPublicRestaurantBySlug(slug);
    if (!restaurant || !restaurant.isAcceptingOrders) return { ok: false, reason: "unavailable" };

    const sections = await fetchMenuSections(restaurant.id);
    const menu = sections.flatMap((section) => section.items);
    const { lines: rebuilt, skipped } = rebuildReorderLines(lines, menu);

    return {
      ok: true,
      restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug },
      lines: rebuilt,
      skipped,
    };
  } catch (cause) {
    console.error("[reorder:prepare]", cause);
    return { ok: false, reason: "failed" };
  }
}
