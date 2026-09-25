import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The customer list for one restaurant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THERE IS NO `customers` TABLE, AND THAT IS DELIBERATE.
 *
 *  A customer of a restaurant is a fact derived from its orders: a registered
 *  person is an `orders.customer_id` pointing at a profile; a guest checkout is
 *  nothing but the name and phone left on the ticket. Materialising that into a
 *  table would create a second place that can disagree with the orders — and it
 *  would disagree the first time an order is cancelled.
 *
 *  The fold is a GROUP BY, which PostgREST cannot express, so it lives in
 *  `manager_customers(uuid)` (migration 0011). The tenant boundary moves down
 *  with it rather than being dropped: `p_restaurant` is the only restaurant the
 *  function reads, and the id must come from requireBranch() — never from a URL
 *  or a form field. The function is granted to `service_role` alone, because
 *  "total spend of every customer, by restaurant id" is not a public endpoint.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface RestaurantCustomer {
  /**
   * Stable key for a row. The profile id for a registered customer, the phone
   * that groups a guest's tickets otherwise — the same key the SQL groups on.
   */
  id: string;
  /** null for a guest checkout: there is no profile behind it. */
  customerId: string | null;
  name: string;
  email: string;
  phone: string;
  orderCount: number;
  /** Whole XAF. Delivery fees and cancelled orders are excluded (0011 §2). */
  totalSpent: number;
  /** Canonical UTC ISO, or "" if the database sent something unparseable. */
  firstOrderAt: string;
  lastOrderAt: string;
  isRegistered: boolean;
}

export interface CustomerTotals {
  count: number;
  orders: number;
  revenue: number;
}

interface DbCustomer {
  customer_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  order_count: number | string;
  total_spent: number | string;
  first_order_at: string | null;
  last_order_at: string | null;
  is_registered: boolean;
}

/**
 * Canonical UTC ISO.
 *
 * Normalised here, on the server, so the client can order two customers by
 * comparing the strings and drop the value straight into `<time dateTime>`.
 * Postgres offsets render consistently today, but a lexicographic sort that is
 * only accidentally chronological is the kind of thing that breaks silently.
 */
function iso(value: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

/**
 * Everyone who has ordered here, biggest spender first.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A MISSING FUNCTION MUST DEGRADE INTO AN EMPTY SCREEN, NOT A CRASH.
 *
 *  Migration 0011 is what creates `manager_customers`. Until it has been run,
 *  PostgREST answers PGRST202 — "function not found" — and a page that rethrows
 *  that is a page the restaurant cannot open to find out what is wrong. It logs
 *  and returns nothing, which renders as "no customers yet"; the server console
 *  is where the reason belongs.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function fetchCustomers(restaurantId: string): Promise<RestaurantCustomer[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("manager_customers", { p_restaurant: restaurantId });

  if (error) {
    console.error("[customers:fetchCustomers]", error.message);
    return [];
  }

  const rows = ((data ?? []) as DbCustomer[]).map((r) => {
    const phone = (r.phone ?? "").trim();

    return {
      // The phone still groups guest orders (see the view), but it never
      // leaves the server: the restaurant sees a customer's number only during
      // a paid delivery (lib/data/orders). A hash keeps the row key stable.
      id: r.customer_id ?? "guest-" + createHash("sha256").update(phone).digest("hex").slice(0, 16),
      customerId: r.customer_id,
      name: (r.name ?? "").trim(),
      email: (r.email ?? "").trim(),
      phone: "",
      // Number(), not a cast: `count(*)` and `sum()` are bigint, which arrives
      // as a JSON number today and as a string the day PostgREST's bigint
      // handling is configured differently. Arithmetic on "12" is "012".
      orderCount: Number(r.order_count) || 0,
      totalSpent: Number(r.total_spent) || 0,
      firstOrderAt: iso(r.first_order_at),
      lastOrderAt: iso(r.last_order_at),
      isRegistered: r.is_registered,
    } satisfies RestaurantCustomer;
  });

  // A GROUP BY has no defined output order. Pinning one here means the list is
  // stable between two loads even before the view applies its own sort.
  return rows.sort((a, b) => b.totalSpent - a.totalSpent || b.orderCount - a.orderCount);
}

/** Folded once, on the server, rather than on every client render. */
export function customerTotals(rows: RestaurantCustomer[]): CustomerTotals {
  let orders = 0;
  let revenue = 0;

  for (const row of rows) {
    orders += row.orderCount;
    revenue += row.totalSpent;
  }

  return { count: rows.length, orders, revenue };
}
