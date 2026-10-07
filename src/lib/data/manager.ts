import "server-only";
import { computeTotals } from "@/lib/orders/totals";
import { isDishCourse, type DishCourse } from "@/lib/menu/course";
import { createAdminClient } from "@/lib/supabase/server";
import type { BranchRole } from "@/lib/capabilities";
import type { CustomerReservationStatus } from "@/lib/format/reservation-status";
import { fetchTableAccess } from "./table-access";

/**
 * Reads for the restaurant dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY FUNCTION HERE TAKES A restaurantId AND FILTERS ON IT.
 *
 *  That is the tenant boundary. These run with the service-role key, which
 *  bypasses RLS entirely, so the `.eq("restaurant_id", …)` in each query is
 *  not a convenience — it is the only thing standing between one restaurant
 *  and another's menu, staff and bookings. The id must come from
 *  `requireBranch()`, never from a URL or a form field.
 * ─────────────────────────────────────────────────────────────────────────
 */

/* ── Menu ──────────────────────────────────────────────────────────────── */

export interface MenuOption {
  id: string;
  groupId: string;
  name: string;
  /** Whole XAF, added to the line price. May be negative. */
  priceDelta: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuOptionGroup {
  id: string;
  menuItemId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  sortOrder: number;
  options: MenuOption[];
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  categoryId: string | null;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isFeatured: boolean;
  prepMinutes: number;
  trackStock: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  dietaryTags: string;
  allergens: string;
  sortOrder: number;
  optionGroups: MenuOptionGroup[];
  /**
   * "Prix confirmé par le restaurant" (0069): `price` is the minimum, the
   * restaurant confirms the real price when accepting. Absent before 0069.
   */
  priceToConfirm?: boolean;
  priceMax?: number | null;
  /**
   * The kind of dish the restaurant chose (0071): light / main / dessert /
   * drink. Null = not chosen, browsed under the inferred one
   * (lib/menu/course). Absent before 0071.
   */
  course?: DishCourse | null;
}

export interface MenuCategory {
  id: string;
  restaurantId: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
}

export async function fetchCategories(restaurantId: string): Promise<MenuCategory[]> {
  const supabase = createAdminClient();

  const [{ data, error }, { data: items }] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, restaurant_id, name, icon, sort_order, is_active")
      .eq("restaurant_id", restaurantId)
      .order("sort_order"),
    supabase.from("menu_items").select("category_id").eq("restaurant_id", restaurantId),
  ]);

  if (error) {
    console.error("[manager:fetchCategories]", error.message);
    return [];
  }

  // Counted here rather than with a grouped query: PostgREST cannot return a
  // GROUP BY, and a menu is small enough that one extra id-only read is
  // cheaper than the alternatives.
  const counts = new Map<string, number>();
  for (const row of (items ?? []) as { category_id: string | null }[]) {
    if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    restaurantId: c.restaurant_id,
    name: c.name,
    icon: c.icon,
    sortOrder: c.sort_order,
    isActive: c.is_active,
    itemCount: counts.get(c.id) ?? 0,
  }));
}

/**
 * The whole menu, options included.
 *
 * Three queries rather than one nested embed. PostgREST can nest two levels,
 * but it cannot ORDER an embedded resource independently of its parent — so
 * options would come back in whatever order Postgres felt like, and "Simple /
 * Moyen / Familial" would render shuffled. Assembling here keeps sort_order
 * meaningful at every level.
 */
export async function fetchMenu(restaurantId: string): Promise<MenuItem[]> {
  const supabase = createAdminClient();

  const { data: items, error } = await supabase
    .from("menu_items")
    .select(
      "id, restaurant_id, category_id, name, description, price, image_url, is_available, is_featured, prep_minutes, track_stock, stock_quantity, low_stock_threshold, dietary_tags, allergens, sort_order",
    )
    .eq("restaurant_id", restaurantId)
    .order("sort_order");

  if (error) {
    console.error("[manager:fetchMenu]", error.message);
    return [];
  }

  const itemIds = (items ?? []).map((i) => i.id as string);
  if (itemIds.length === 0) return [];

  const { data: groups } = await supabase
    .from("menu_option_groups")
    .select("id, menu_item_id, name, min_select, max_select, is_required, sort_order")
    .in("menu_item_id", itemIds)
    .order("sort_order");

  const groupIds = (groups ?? []).map((g) => g.id as string);

  const { data: options } = groupIds.length
    ? await supabase
        .from("menu_options")
        .select("id, group_id, name, price_delta, is_available, sort_order")
        .in("group_id", groupIds)
        .order("sort_order")
    : { data: [] };

  const optionsByGroup = new Map<string, MenuOption[]>();
  for (const row of (options ?? []) as unknown as {
    id: string;
    group_id: string;
    name: string;
    price_delta: number;
    is_available: boolean;
    sort_order: number;
  }[]) {
    const list = optionsByGroup.get(row.group_id) ?? [];
    list.push({
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      priceDelta: row.price_delta,
      isAvailable: row.is_available,
      sortOrder: row.sort_order,
    });
    optionsByGroup.set(row.group_id, list);
  }

  const groupsByItem = new Map<string, MenuOptionGroup[]>();
  for (const g of (groups ?? []) as unknown as {
    id: string;
    menu_item_id: string;
    name: string;
    min_select: number;
    max_select: number;
    is_required: boolean;
    sort_order: number;
  }[]) {
    const list = groupsByItem.get(g.menu_item_id) ?? [];
    list.push({
      id: g.id,
      menuItemId: g.menu_item_id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      isRequired: g.is_required,
      sortOrder: g.sort_order,
      options: optionsByGroup.get(g.id) ?? [],
    });
    groupsByItem.set(g.menu_item_id, list);
  }

  // The 0069 pricing columns, read on their own: a database without them
  // still serves the whole menu, every dish at its fixed price.
  const { data: pricing } = await supabase
    .from("menu_items")
    .select("id, price_to_confirm, price_max")
    .eq("restaurant_id", restaurantId);
  const pricingById = new Map(
    ((pricing ?? []) as { id: string; price_to_confirm: boolean | null; price_max: number | null }[])
      .map((row) => [row.id, row]),
  );

  // The 0071 course column, the same way: absent, every dish is "not chosen".
  const { data: courses } = await supabase
    .from("menu_items")
    .select("id, course")
    .eq("restaurant_id", restaurantId);
  const courseById = new Map(
    ((courses ?? []) as { id: string; course: string | null }[]).map((row) => [row.id, row.course]),
  );

  return (items ?? []).map((i) => ({
    id: i.id,
    restaurantId: i.restaurant_id,
    categoryId: i.category_id,
    name: i.name,
    description: i.description,
    price: i.price,
    imageUrl: i.image_url,
    isAvailable: i.is_available,
    isFeatured: i.is_featured,
    prepMinutes: i.prep_minutes,
    trackStock: i.track_stock,
    stockQuantity: i.stock_quantity,
    lowStockThreshold: i.low_stock_threshold,
    dietaryTags: i.dietary_tags,
    allergens: i.allergens,
    sortOrder: i.sort_order,
    optionGroups: groupsByItem.get(i.id) ?? [],
    priceToConfirm: Boolean(pricingById.get(i.id)?.price_to_confirm),
    priceMax: pricingById.get(i.id)?.price_max ?? null,
    course: isDishCourse(courseById.get(i.id)) ? (courseById.get(i.id) as DishCourse) : null,
  }));
}

/** One item with its options, scoped to the branch so an id from a URL cannot cross tenants. */
export async function fetchMenuItem(restaurantId: string, itemId: string): Promise<MenuItem | null> {
  const all = await fetchMenu(restaurantId);
  return all.find((i) => i.id === itemId) ?? null;
}

/* ── Staff ─────────────────────────────────────────────────────────────── */

export interface StaffMember {
  id: string;
  profileId: string | null;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: BranchRole;
  status: "invited" | "active" | "suspended";
  invitedAt: string | null;
  acceptedAt: string | null;
  lastActiveAt: string | null;
  /** True for the restaurant's owner row — the one that must never be removed. */
  isOwner: boolean;
}

export async function fetchStaff(restaurantId: string): Promise<StaffMember[]> {
  const supabase = createAdminClient();

  // ── The embed is disambiguated ON PURPOSE ──
  // restaurant_staff points at profiles TWICE — `profile_id` (the employee)
  // and `invited_by` (whoever sent the invitation). A bare `profiles(...)`
  // makes PostgREST refuse the whole query rather than guess, so the FK
  // constraint name picks the side we mean. Never shorten this back.
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select(
      `id, profile_id, role, status, invited_email, display_name, invited_at, accepted_at, last_active_at,
       profiles!restaurant_staff_profile_id_fkey ( name, email, phone, avatar_url )`,
    )
    .eq("restaurant_id", restaurantId)
    .order("created_at");

  if (error) {
    console.error("[manager:fetchStaff]", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      profile_id: string | null;
      role: string;
      status: string;
      invited_email: string | null;
      display_name: string | null;
      invited_at: string | null;
      accepted_at: string | null;
      last_active_at: string | null;
      profiles: { name: string; email: string; phone: string | null; avatar_url: string | null } | null;
    };

    return {
      id: r.id,
      profileId: r.profile_id,
      // An outstanding invite has no profile yet, so the address it was sent
      // to is the only name we have. Showing that beats an empty row.
      name: r.profiles?.name ?? r.display_name ?? r.invited_email ?? "Invitation en attente",
      email: r.profiles?.email ?? r.invited_email ?? "",
      phone: r.profiles?.phone ?? null,
      avatarUrl: r.profiles?.avatar_url ?? null,
      role: r.role as BranchRole,
      status: r.status as StaffMember["status"],
      invitedAt: r.invited_at,
      acceptedAt: r.accepted_at,
      lastActiveAt: r.last_active_at,
      isOwner: r.role === "owner",
    };
  });
}

/* ── Reservations ──────────────────────────────────────────────────────── */

export interface Reservation {
  id: string;
  reference: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
  partySize: number;
  reservedFor: string;
  durationMin: number;
  /** `awaiting_payment`: accepted, table held, deposit not yet paid (0039). */
  status: CustomerReservationStatus;
  tableId: string | null;
  tableNumber: string | null;
  notes: string | null;
  declineReason: string | null;
  /** The acompte required for this booking (migration 0025). 0 = none. */
  depositAmount: number;
  /** Percentage-of-the-bill deposit (migration 0031), snapshotted at booking. */
  depositPercent: number;
  depositPaid: boolean;
  createdAt: string;
  /* ── 0068 (empty on a database without it) ─────────────────────────── */
  customerId: string | null;
  voucherCode: string | null;
  voucherRedeemedAt: string | null;
  occasion: string | null;
  seatingPreference: string | null;
  isGroupRequest: boolean;
  source: "online" | "phone" | "walk_in";
  pendingChange: { reservedFor: string; partySize: number; requestedAt: string } | null;
  /** Every table held, the main one first. */
  tableIds: string[];
  tableNumbers: string[];
  /** This guest at this restaurant: past visits, no-shows, staff note. Null for phone bookings. */
  guestHistory: { visits: number; noShows: number; lastVisit: string | null; note: string | null } | null;
}

export async function fetchReservations(
  restaurantId: string,
  options: { from?: Date; status?: string } = {},
): Promise<Reservation[]> {
  const supabase = createAdminClient();

  /*
    `restaurant_tables!table_id` — THE RELATIONSHIP IS NAMED, AND MUST STAY SO.

    0068 let a booking hold several tables (reservation_tables). From that
    moment the database knew TWO ways from a booking to a table — its own
    `table_id`, and the new link table — and refused the unnamed embed as
    ambiguous (PGRST201). This function logs an error and returns [], so the
    board went empty while the menu badge and the notifications, which only
    count, kept announcing bookings nobody could see. The hint says which one
    is meant: the booking's main table.
  */
  let query = supabase
    .from("reservations")
    .select(
      `id, reference, guest_name, guest_phone, guest_email, party_size, reserved_for,
       duration_min, status, table_id, notes, decline_reason, deposit_amount, deposit_percent,
       deposit_paid, created_at,
       restaurant_tables!table_id ( number )`,
    )
    .eq("restaurant_id", restaurantId)
    .order("reserved_for");

  if (options.from) query = query.gte("reserved_for", options.from.toISOString());
  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;

  if (error) {
    console.error("[manager:fetchReservations]", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      reference: string;
      guest_name: string;
      guest_phone: string;
      guest_email: string | null;
      party_size: number;
      reserved_for: string;
      duration_min: number;
      status: Reservation["status"];
      table_id: string | null;
      notes: string | null;
      decline_reason: string | null;
      deposit_amount: number;
      deposit_percent: number | null;
      deposit_paid: boolean;
      created_at: string;
      restaurant_tables: { number: string } | null;
    };

    return {
      id: r.id,
      reference: r.reference,
      guestName: r.guest_name,
      // Never sent to the back office: bookings are discussed in the chat;
      // only a paid delivery in progress releases a customer's number.
      guestPhone: "",
      guestEmail: r.guest_email,
      partySize: r.party_size,
      reservedFor: r.reserved_for,
      durationMin: r.duration_min,
      status: r.status,
      tableId: r.table_id,
      tableNumber: r.restaurant_tables?.number ?? null,
      notes: r.notes,
      declineReason: r.decline_reason,
      depositAmount: Number(r.deposit_amount),
      depositPercent: Number(r.deposit_percent ?? 0),
      depositPaid: Boolean(r.deposit_paid),
      createdAt: r.created_at,
      customerId: null,
      voucherCode: null,
      voucherRedeemedAt: null,
      occasion: null,
      seatingPreference: null,
      isGroupRequest: false,
      source: "online" as const,
      pendingChange: null,
      tableIds: r.table_id ? [r.table_id] : [],
      tableNumbers: r.restaurant_tables?.number ? [r.restaurant_tables.number] : [],
      guestHistory: null,
    };
  });
}

/**
 * The 0068 details for the board, read beside fetchReservations so a
 * database without 0068 still shows every booking.
 */
export async function withBookingDetails(restaurantId: string, rows: Reservation[]): Promise<Reservation[]> {
  if (rows.length === 0) return rows;
  const supabase = createAdminClient();
  const ids = rows.map((row) => row.id);
  const [extras, links] = await Promise.all([
    supabase
      .from("reservations")
      .select("id, customer_id, voucher_code, voucher_redeemed_at, occasion, seating_preference, is_group_request, source, pending_change")
      .in("id", ids),
    supabase.from("reservation_tables").select("reservation_id, table_id, restaurant_tables ( number )").in("reservation_id", ids),
  ]);
  if (extras.error) return rows;

  type Extra = {
    id: string; customer_id: string | null; voucher_code: string | null; voucher_redeemed_at: string | null;
    occasion: string | null; seating_preference: string | null; is_group_request: boolean | null; source: string | null;
    pending_change: { reservedFor?: string; partySize?: number; requestedAt?: string } | null;
  };
  const extraById = new Map(((extras.data ?? []) as Extra[]).map((e) => [e.id, e]));
  const linksBy = new Map<string, { id: string; number: string }[]>();
  for (const link of (links.error ? [] : links.data ?? []) as { reservation_id: string; table_id: string; restaurant_tables: { number: string } | { number: string }[] | null }[]) {
    const table = Array.isArray(link.restaurant_tables) ? link.restaurant_tables[0] : link.restaurant_tables;
    const list = linksBy.get(link.reservation_id) ?? [];
    list.push({ id: link.table_id, number: table?.number ?? "?" });
    linksBy.set(link.reservation_id, list);
  }

  // Guest history: how often each account came, and failed to come, here.
  const customerIds = [...new Set(((extras.data ?? []) as Extra[]).map((e) => e.customer_id).filter((id): id is string => Boolean(id)))];
  const history = new Map<string, { visits: number; noShows: number; lastVisit: string | null; note: string | null }>();
  if (customerIds.length) {
    const [past, notes] = await Promise.all([
      supabase
        .from("reservations")
        .select("customer_id, status, reserved_for")
        .eq("restaurant_id", restaurantId)
        .in("customer_id", customerIds)
        .in("status", ["completed", "seated", "no_show"])
        .lt("reserved_for", new Date().toISOString()),
      supabase.from("restaurant_guest_notes").select("customer_id, note").eq("restaurant_id", restaurantId).in("customer_id", customerIds),
    ]);
    for (const id of customerIds) history.set(id, { visits: 0, noShows: 0, lastVisit: null, note: null });
    for (const row of (past.data ?? []) as { customer_id: string; status: string; reserved_for: string }[]) {
      const entry = history.get(row.customer_id)!;
      if (row.status === "no_show") entry.noShows++;
      else {
        entry.visits++;
        if (!entry.lastVisit || row.reserved_for > entry.lastVisit) entry.lastVisit = row.reserved_for;
      }
    }
    for (const row of (notes.error ? [] : notes.data ?? []) as { customer_id: string; note: string }[]) {
      history.get(row.customer_id)!.note = row.note;
    }
  }

  return rows.map((row) => {
    const extra = extraById.get(row.id);
    if (!extra) return row;
    const linked = linksBy.get(row.id) ?? [];
    const main = linked.find((l) => l.id === row.tableId);
    const ordered = main ? [main, ...linked.filter((l) => l !== main)] : linked;
    return {
      ...row,
      customerId: extra.customer_id,
      voucherCode: extra.voucher_code,
      voucherRedeemedAt: extra.voucher_redeemed_at,
      occasion: extra.occasion,
      seatingPreference: extra.seating_preference,
      isGroupRequest: Boolean(extra.is_group_request),
      source: (extra.source === "phone" || extra.source === "walk_in" ? extra.source : "online") as Reservation["source"],
      pendingChange: extra.pending_change?.reservedFor
        ? {
            reservedFor: extra.pending_change.reservedFor,
            partySize: Number(extra.pending_change.partySize ?? row.partySize),
            requestedAt: extra.pending_change.requestedAt ?? "",
          }
        : null,
      tableIds: ordered.length ? ordered.map((l) => l.id) : row.tableIds,
      tableNumbers: ordered.length ? ordered.map((l) => l.number) : row.tableNumbers,
      guestHistory: extra.customer_id ? history.get(extra.customer_id) ?? null : null,
    };
  });
}

/* ── Tables ────────────────────────────────────────────────────────────── */

export interface RestaurantTable {
  id: string;
  number: string;
  capacity: number;
  status: "available" | "occupied" | "reserved" | "out_of_service";
  /** People sitting right now, from the newest open dine-in order on the
   *  table. Null when nobody is seated (or the waiter never said). */
  activePartySize: number | null;
  /** Frozen by the package cap; the stored floor status remains unchanged. */
  planLocked: boolean;
  /** Opaque locator embedded in this table’s printable QR code. */
  publicToken?: string | null;
  /** "Terrasse", "Salle", "VIP"… (0068) — what a booking preference matches. */
  zone?: string | null;
}

export async function fetchTables(restaurantId: string): Promise<RestaurantTable[]> {
  const supabase = createAdminClient();

  const access = await fetchTableAccess(restaurantId).catch((error) => {
    console.error("[manager:fetchTables]", error);
    return null;
  });
  if (!access) return [];
  const tables = access.tables;

  // Optional until migration 0054 is applied. Keeping it separate prevents an
  // unapplied QR migration from making the existing floor disappear.
  const { data: qrRows } = await supabase
    .from("restaurant_tables")
    .select("id, public_token")
    .eq("restaurant_id", restaurantId);
  const qrById = new Map(((qrRows ?? []) as { id: string; public_token: string }[]).map((row) => [row.id, row.public_token]));
  // Zones (0068), read on their own for the same reason.
  const { data: zoneRows } = await supabase
    .from("restaurant_tables")
    .select("id, zone")
    .eq("restaurant_id", restaurantId);
  const zoneById = new Map(((zoneRows ?? []) as { id: string; zone: string | null }[]).map((row) => [row.id, row.zone]));

  // Occupancy comes from the open dine-in orders, not from a join: orders
  // carry the table NUMBER as a snapshot (the waiter could rename the table
  // mid-service without rewriting history), so the match happens here, on
  // the numbers both sides speak. The NEWEST order wins when several are
  // open on one table — the first of a round is the party that sat down.
  const { data: openRows } = await supabase
    .from("orders")
    .select("table_number, party_size, created_at")
    .eq("restaurant_id", restaurantId)
    .eq("type", "dine_in")
    .not("status", "in", '("cancelled","delivered")')
    .not("table_number", "is", null);

  const byNumber = new Map<string, { party: number; at: string }>();
  for (const row of (openRows ?? []) as { table_number: string; party_size: number | null; created_at: string }[]) {
    if (!row.party_size) continue;
    const seen = byNumber.get(row.table_number);
    if (!seen || row.created_at > seen.at) {
      byNumber.set(row.table_number, { party: row.party_size, at: row.created_at });
    }
  }

  return tables.map((t) => ({
    ...t,
    publicToken: qrById.get(t.id) ?? null,
    zone: zoneById.get(t.id) ?? null,
    activePartySize: byNumber.get(t.number)?.party ?? null,
  }));
}

/* ── Promotions ────────────────────────────────────────────────────────── */

export interface Promotion {
  id: string;
  code: string;
  label: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
}

export async function fetchPromotions(restaurantId: string): Promise<Promotion[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("promotions")
    .select(
      "id, code, label, discount_type, discount_value, min_order, max_discount, starts_at, ends_at, usage_limit, used_count, is_active",
    )
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[manager:fetchPromotions]", error.message);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    label: p.label,
    discountType: p.discount_type as Promotion["discountType"],
    discountValue: p.discount_value,
    minOrder: p.min_order,
    maxDiscount: p.max_discount,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    usageLimit: p.usage_limit,
    usedCount: p.used_count,
    isActive: p.is_active,
  }));
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */

export interface BranchOverview {
  ordersToday: number;
  revenueToday: number;
  /** Today's orders still waiting on a yes/no — excluded from revenueToday. */
  awaitingConfirmation: number;
  /** Orders in progress: waiting on us or the customer, or in the kitchen. */
  pendingOrders: number;
  /**
   * Orders waiting on the RESTAURANT to accept (`pending`) — the only ones
   * that are "urgent" for us. `awaiting_customer` is the customer's move and
   * confirmed/preparing are the kitchen's normal work; counting them in the
   * red "customers are waiting for your answer" box cried wolf all service.
   */
  waitingOrders: number;
  pendingReservations: number;
  menuItems: number;
  unavailableItems: number;
  lowStockItems: number;
  /** Reviews written by customers that the restaurant has not answered. */
  unrepliedReviews: number;
  staffCount: number;
  averageRating: number;
  reviewCount: number;
}


/**
 * The dashboard's "N avis sans réponse" (0066): unanswered AND not marked
 * read AND not answered by a reaction (a reaction only answers 3★+). Same
 * rule as lib/reviews/attention. Falls back to "no written reply" before
 * migration 0066.
 */
async function countReviewsNeedingAttention(restaurantId: string): Promise<{ count: number | null }> {
  const supabase = createAdminClient();
  const scoped = () =>
    supabase
      .from("reviews")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .is("reply", null)
      .is("removed_at", null)
      .eq("is_reported", false);
  const { count, error } = await scoped()
    .is("restaurant_seen_at", null)
    .is("restaurant_reaction", null);
  if (!error) return { count };
  const fallback = await scoped();
  return { count: fallback.count };
}

/**
 * The figures on /m.
 *
 * Counts use `head: true` — PostgREST returns the count in a header and no
 * rows at all, so "how many orders today" does not transfer today's orders
 * over the wire to be measured with .length.
 */
export async function fetchBranchOverview(restaurantId: string): Promise<BranchOverview> {
  const supabase = createAdminClient();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since = startOfToday.toISOString();

  const count = (table: string) =>
    supabase.from(table).select("*", { count: "exact", head: true }).eq("restaurant_id", restaurantId);

  const [today, pending, waiting, reservations, items, unavailable, staff, unrepliedReviews, restaurant] =
    await Promise.all([
      supabase
        .from("orders")
        .select("subtotal, discount_amount, status")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", since),
      count("orders").in("status", ["pending", "awaiting_customer", "confirmed", "preparing"]),
      count("orders").eq("status", "pending"),
      count("reservations").eq("status", "pending"),
      count("menu_items"),
      count("menu_items").eq("is_available", false),
      count("restaurant_staff").eq("status", "active"),
      countReviewsNeedingAttention(restaurantId),
      supabase.from("restaurants").select("rating, review_count").eq("id", restaurantId).maybeSingle(),
    ]);

  const todayRows = (today.data ?? []) as { subtotal: number; discount_amount: number; status: string }[];

  /*
    ────────────────────────────────────────────────────────────────────────
     REVENUE COUNTS ORDERS THE RESTAURANT HAS ACCEPTED. NOTHING ELSE.

     This used to be "everything except cancelled", which quietly included
     `pending` — an order the restaurant has not even looked at yet. The
     number therefore jumped the instant a customer pressed Place order, and
     kept the money in the total for as long as it sat unanswered. A
     restaurant watching its dashboard saw revenue it had not earned and, for
     every order it went on to decline, revenue it never would.

     It also made the figure non-monotonic in the worst way: it went DOWN
     when an order was refused, so a bad morning read as a mysterious loss
     rather than as orders that were never taken.

     `confirmed` is the line. It is the first state that means a human at the
     restaurant said yes, and it is the same line the customer sees ("the
     restaurant has accepted your order"). Everything past it — preparing,
     shipped, delivered — is accepted too.

     NOT `delivered` only. That would be the accountant's answer and the
     wrong one for a dashboard read at 3pm: the food is cooked and the money
     is committed long before the rider comes back.
    ────────────────────────────────────────────────────────────────────────
  */
  const EARNED: string[] = ["confirmed", "preparing", "shipped", "delivered"];

  const revenueToday = todayRows
    .filter((o) => EARNED.includes(o.status))
    // Points are funded by the platform; the restaurant still earns the food value.
    .reduce((sum, o) => sum + computeTotals({ subtotal: o.subtotal, discount: o.discount_amount }).netFood, 0);

  // Shown beside the revenue so the gap between "orders today" and the money
  // is explained rather than left to look like a bug.
  const awaitingConfirmation = todayRows.filter((o) => o.status === "pending").length;

  // Low stock needs the two columns compared against each other, which
  // PostgREST cannot express as a filter — so it is read and counted here.
  const { data: stockRows } = await supabase
    .from("menu_items")
    .select("stock_quantity, low_stock_threshold")
    .eq("restaurant_id", restaurantId)
    .eq("track_stock", true);

  const lowStockItems = ((stockRows ?? []) as { stock_quantity: number | null; low_stock_threshold: number | null }[])
    .filter((r) => r.stock_quantity !== null && r.low_stock_threshold !== null && r.stock_quantity <= r.low_stock_threshold)
    .length;

  return {
    ordersToday: todayRows.length,
    revenueToday,
    awaitingConfirmation,
    pendingOrders: pending.count ?? 0,
    waitingOrders: waiting.count ?? 0,
    pendingReservations: reservations.count ?? 0,
    menuItems: items.count ?? 0,
    unavailableItems: unavailable.count ?? 0,
    lowStockItems,
    unrepliedReviews: unrepliedReviews.count ?? 0,
    staffCount: staff.count ?? 0,
    averageRating: restaurant.data?.rating ?? 0,
    reviewCount: restaurant.data?.review_count ?? 0,
  };
}

/* ── Delivery fee band (migration 0035) ───────────────────────────────── */

/**
 * What this restaurant advertises as its delivery fee range.
 *
 * Read on the orders queue so the confirmation dialog can pre-fill the
 * minimum and refuse anything above the maximum — the customer saw both
 * numbers before they ordered, and a promise the confirmation screen ignores
 * is worse than one never made.
 *
 * Falls back to a zeroed band on any failure, which every caller reads as
 * "nothing declared". A missing column (migration 0035 not yet run) must
 * degrade to the old unconstrained behaviour, never to a blocked queue.
 */
export async function fetchDeliveryFeeBand(
  restaurantId: string,
): Promise<{ min: number; max: number }> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("restaurants")
    .select("min_delivery_fee, max_delivery_fee")
    .eq("id", restaurantId)
    .maybeSingle();

  if (error) {
    console.error("[manager:fetchDeliveryFeeBand]", error.message);
    return { min: 0, max: 0 };
  }

  return {
    min: Number(data?.min_delivery_fee) || 0,
    max: Number(data?.max_delivery_fee) || 0,
  };
}

/* ── The "finish your setup" checklist ─────────────────────────────────── */

export interface SetupChecklist {
  /** A logo is the single biggest difference between a card people tap and one they scroll past. */
  hasLogo: boolean;
  /** The cover photo behind the restaurant page header. */
  hasCover: boolean;
  /** A real description, not the empty string the application may have left. */
  hasDescription: boolean;
  /** A cuisine, so the restaurant appears under the filters people actually use. */
  hasCuisine: boolean;
  /** At least one dish. A listed restaurant with an empty card takes no orders. */
  hasMenu: boolean;
  /** At least one table, so bookings and dine-in orders have somewhere to go. */
  hasTables: boolean;
  /** Opening hours on at least one day — otherwise the page reads "closed" forever. */
  hasHours: boolean;
  /** Does the restaurant deliver at all? Drives the dashboard toggle. */
  acceptsDelivery: boolean;
  /** Own riders vs platform-managed. Only meaningful when acceptsDelivery. */
  hasOwnDelivery: boolean;
}

/**
 * Everything the dashboard's setup panel needs, in one read.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE WIZARD DELIBERATELY DOES NOT ASK FOR ANY OF THIS.
 *
 *  Onboarding is five short steps because a long one is where restaurants
 *  abandon signup — so the logo, the cover photo, the description and the
 *  cuisine are all skipped. Which is right, and which means a brand-new
 *  restaurant goes live looking anonymous: a grey placeholder card in a
 *  directory of photographs.
 *
 *  This is the other half of that trade. The wizard stays short; the
 *  dashboard carries the rest as a checklist the restaurant can finish
 *  whenever it likes, and the arrival from onboarding scrolls straight to it.
 *  Nothing here is blocking — every item is "your page would be better with
 *  this", never "you cannot trade without it".
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function fetchSetupChecklist(restaurantId: string): Promise<SetupChecklist> {
  const supabase = createAdminClient();

  const [restaurant, menu, tables, hours] = await Promise.all([
    supabase
      .from("restaurants")
      .select("logo_url, cover_url, description, cuisine_id, accepts_delivery, has_own_delivery")
      .eq("id", restaurantId)
      .maybeSingle(),
    supabase
      .from("menu_items")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId),
    supabase
      .from("restaurant_tables")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId),
    // "Has hours" means at least one day that actually opens. A row per day
    // exists whether or not the restaurant trades that day, so counting rows
    // would report success for a week of closures.
    supabase
      .from("restaurant_hours")
      .select("*", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .not("opens_at", "is", null),
  ]);

  const row = restaurant.data as {
    logo_url: string | null;
    cover_url: string | null;
    description: string | null;
    cuisine_id: string | null;
    accepts_delivery: boolean | null;
    has_own_delivery: boolean | null;
  } | null;

  return {
    hasLogo: Boolean(row?.logo_url),
    hasCover: Boolean(row?.cover_url),
    hasDescription: Boolean(row?.description?.trim()),
    hasCuisine: Boolean(row?.cuisine_id),
    hasMenu: (menu.count ?? 0) > 0,
    hasTables: (tables.count ?? 0) > 0,
    hasHours: (hours.count ?? 0) > 0,
    acceptsDelivery: row?.accepts_delivery !== false,
    hasOwnDelivery: row?.has_own_delivery !== false,
  };
}
