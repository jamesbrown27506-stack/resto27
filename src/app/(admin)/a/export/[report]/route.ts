import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { writeAudit } from "@/lib/data/platform-actions";
import { csvResponse, toCsv, type CsvColumn } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * CSV export endpoint.
 *
 * A Route Handler rather than a Server Action, because an Action cannot return
 * a file download — the browser needs a real response with
 * `content-disposition`.
 *
 * That also means it does NOT pass through the admin layout, so the role check
 * below is the only thing standing between this URL and every tenant's
 * financial data. It is not optional.
 */

type Row = Record<string, unknown>;

interface Report {
  table: string;
  select: string;
  order?: { column: string; ascending?: boolean };
  columns: CsvColumn<Row>[];
}

const get = (key: string) => (row: Row) => row[key];

/** Flattens a PostgREST nested relation down to one field. */
const nested = (key: string, field: string) => (row: Row) =>
  (row[key] as Record<string, unknown> | null)?.[field] ?? "";

const REPORTS: Record<string, Report> = {
  restaurants: {
    table: "restaurants",
    select: `slug, name, branch_label, status, description, phone, rating, review_count,
             minimum_order, delivery_estimate_min, accepts_delivery, accepts_pickup, created_at,
             cuisines ( name ), quartiers ( name ), service_areas ( city )`,
    order: { column: "name", ascending: true },
    columns: [
      { header: "Slug", value: get("slug") },
      { header: "Name", value: get("name") },
      { header: "Branch", value: get("branch_label") },
      { header: "Status", value: get("status") },
      { header: "Cuisine", value: nested("cuisines", "name") },
      { header: "Neighbourhood", value: nested("quartiers", "name") },
      { header: "City", value: nested("service_areas", "city") },
      { header: "Phone", value: get("phone") },
      { header: "Rating", value: get("rating") },
      { header: "Reviews", value: get("review_count") },
      { header: "Minimum order (XAF)", value: get("minimum_order") },
      { header: "Delivery estimate (min)", value: get("delivery_estimate_min") },
      { header: "Accepts delivery", value: get("accepts_delivery") },
      { header: "Accepts pickup", value: get("accepts_pickup") },
      { header: "Created", value: get("created_at") },
    ],
  },

  users: {
    table: "profiles",
    select: "name, email, phone, role, status, deleted_at, created_at",
    order: { column: "created_at", ascending: false },
    columns: [
      { header: "Name", value: get("name") },
      { header: "Email", value: get("email") },
      { header: "Phone", value: get("phone") },
      { header: "Role", value: get("role") },
      { header: "Status", value: get("status") },
      { header: "Anonymised at", value: get("deleted_at") },
      { header: "Joined", value: get("created_at") },
    ],
  },

  orders: {
    table: "orders",
    select: `reference, type, status, subtotal, discount_amount, service_charge, delivery_fee,
             delivery_fee_set_at, loyalty_value, total, currency, payment_method, is_paid,
             delivery_quartier, promo_code, created_at, delivered_at,
             restaurants ( name )`,
    order: { column: "created_at", ascending: false },
    columns: [
      { header: "Reference", value: get("reference") },
      { header: "Restaurant", value: nested("restaurants", "name") },
      { header: "Type", value: get("type") },
      { header: "Status", value: get("status") },
      { header: "Subtotal (XAF)", value: get("subtotal") },
      { header: "Discount (XAF)", value: get("discount_amount") },
      { header: "Service charge (XAF)", value: get("service_charge") },
      { header: "Delivery fee (XAF)", value: get("delivery_fee") },
      // Blank here means the fee was never quoted (§4), which is a different
      // thing from a fee of zero.
      { header: "Delivery fee quoted at", value: get("delivery_fee_set_at") },
      { header: "Loyalty (XAF)", value: get("loyalty_value") },
      { header: "Total (XAF)", value: get("total") },
      { header: "Currency", value: get("currency") },
      { header: "Payment method", value: get("payment_method") },
      { header: "Paid", value: get("is_paid") },
      { header: "Neighbourhood", value: get("delivery_quartier") },
      { header: "Promo code", value: get("promo_code") },
      { header: "Created", value: get("created_at") },
      { header: "Delivered", value: get("delivered_at") },
    ],
  },

  "order-items": {
    table: "order_items",
    select: "name, unit_price, quantity, options_label, notes, created_at, orders ( reference )",
    order: { column: "created_at", ascending: false },
    columns: [
      { header: "Order", value: nested("orders", "reference") },
      { header: "Item", value: get("name") },
      // The snapshot (§3), not today's menu price.
      { header: "Unit price at order (XAF)", value: get("unit_price") },
      { header: "Quantity", value: get("quantity") },
      { header: "Options", value: get("options_label") },
      { header: "Notes", value: get("notes") },
    ],
  },

  invoices: {
    table: "invoices",
    select: `number, amount, currency, status, period_start, period_end, issued_at, paid_at,
             restaurants ( name ), subscription_plans ( name )`,
    order: { column: "issued_at", ascending: false },
    columns: [
      { header: "Number", value: get("number") },
      { header: "Restaurant", value: nested("restaurants", "name") },
      { header: "Plan", value: nested("subscription_plans", "name") },
      { header: "Amount (XAF)", value: get("amount") },
      { header: "Currency", value: get("currency") },
      { header: "Status", value: get("status") },
      { header: "Period start", value: get("period_start") },
      { header: "Period end", value: get("period_end") },
      { header: "Issued", value: get("issued_at") },
      { header: "Paid", value: get("paid_at") },
    ],
  },

  payments: {
    table: "payments",
    select: "amount, currency, method, provider, confirmed_by, created_at, invoices ( number )",
    order: { column: "created_at", ascending: false },
    columns: [
      { header: "Invoice", value: nested("invoices", "number") },
      { header: "Amount (XAF)", value: get("amount") },
      { header: "Currency", value: get("currency") },
      { header: "Method", value: get("method") },
      { header: "Provider", value: get("provider") },
      { header: "Confirmed by", value: get("confirmed_by") },
      { header: "Created", value: get("created_at") },
    ],
  },

  commissions: {
    table: "commission_statements",
    select: `period_start, period_end, order_count, gross_sales, commission_rate,
             commission_amount, status, issued_at, settled_at, restaurants ( name )`,
    order: { column: "period_start", ascending: false },
    columns: [
      { header: "Restaurant", value: nested("restaurants", "name") },
      { header: "Period start", value: get("period_start") },
      { header: "Period end", value: get("period_end") },
      { header: "Orders", value: get("order_count") },
      // Delivered, non-refunded, delivery fees excluded (§7).
      { header: "Qualifying sales (XAF)", value: get("gross_sales") },
      // Frozen at generation — not today's plan rate.
      { header: "Rate at generation (%)", value: get("commission_rate") },
      { header: "Commission (XAF)", value: get("commission_amount") },
      { header: "Status", value: get("status") },
      { header: "Issued", value: get("issued_at") },
      { header: "Settled", value: get("settled_at") },
    ],
  },

  refunds: {
    table: "refunds",
    select: `reference, type, amount, currency, reason, status, created_by, created_at,
             completed_at, restaurants ( name )`,
    order: { column: "created_at", ascending: false },
    columns: [
      { header: "Reference", value: get("reference") },
      { header: "Restaurant", value: nested("restaurants", "name") },
      { header: "Type", value: get("type") },
      { header: "Amount (XAF)", value: get("amount") },
      { header: "Currency", value: get("currency") },
      { header: "Reason", value: get("reason") },
      { header: "Status", value: get("status") },
      { header: "Created by", value: get("created_by") },
      { header: "Created", value: get("created_at") },
      { header: "Completed", value: get("completed_at") },
    ],
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  // This handler bypasses the admin layout, so it does its own authorization.
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin" || profile.status !== "active") {
    // 404, not 403: confirming the endpoint exists tells an unauthorised
    // caller something they did not know a moment ago.
    return new NextResponse("Not found", { status: 404 });
  }

  const { report: key } = await params;
  const report = REPORTS[key];
  if (!report) return new NextResponse("Not found", { status: 404 });

  const supabase = createAdminClient();
  let query = supabase.from(report.table).select(report.select);
  if (report.order) {
    query = query.order(report.order.column, { ascending: report.order.ascending ?? true });
  }

  const { data, error } = await query;

  if (error) {
    console.error("[export]", key, error.message);
    return new NextResponse(`Could not read ${report.table}: ${error.message}`, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];

  await writeAudit(profile, {
    action: "export.download",
    entityType: "export",
    entityId: key,
    summary: `Exported ${rows.length} row(s) from ${report.table}`,
  });

  return csvResponse(key, toCsv(rows, report.columns));
}
