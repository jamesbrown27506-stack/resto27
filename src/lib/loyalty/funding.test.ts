import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customer = id(1), restaurant = id(2), order = id(3), attempt = id(4);
let db: PGlite;
const scalar = async (sql: string, params: unknown[] = []) => (await db.query<{ value: unknown }>(sql, params)).rows[0]?.value;
const settle = (attemptId = attempt) => scalar("select settle_online_order_payment($1,$2) as value", [order, attemptId]);
const cancel = () => scalar("select cancel_paid_order($1,'Owner','Unavailable') as value", [order]);
const schema = `
create role anon; create role authenticated; create role service_role;
create table profiles(id uuid primary key);
create table restaurants(id uuid primary key);
create table settings(key text primary key, value text);
create table orders(id uuid primary key, restaurant_id uuid references restaurants, customer_id uuid references profiles,
 reference text, status text default 'awaiting_customer', is_paid boolean default false, payment_method text default 'mobile_money',
 subtotal integer default 1000, discount_amount integer default 0, total integer, service_charge integer default 15,
 loyalty_value integer, loyalty_points_used integer, paid_attempt_id uuid, dining_session_id uuid, delivered_at timestamptz,
 cancelled_at timestamptz, cancelled_reason text, delivery_phone text, created_at timestamptz default now(), type text default 'pickup');
create table loyalty_ledger(id uuid primary key default gen_random_uuid(), profile_id uuid, restaurant_id uuid,
 order_id uuid, points integer check(points<>0), kind text, note text);
create table restaurant_wallets(restaurant_id uuid primary key, balance integer check(balance>=0), updated_at timestamptz);
create table wallet_ledger(id uuid default gen_random_uuid(), restaurant_id uuid, amount integer, kind text, note text, reference text);
create table customer_wallets(profile_id uuid primary key, balance integer check(balance>=0), updated_at timestamptz);
create table customer_wallet_ledger(profile_id uuid, amount integer, kind text, note text, reference text, balance_after integer);
create table platform_revenue_ledger(source_type text, source_id uuid, restaurant_id uuid, gross integer, amount integer, reference text, note text, unique(source_type,source_id));
create table order_status_history(order_id uuid, status text, by_name text, note text);
create table refunds(id uuid default gen_random_uuid(), reference text, restaurant_id uuid, order_id uuid, type text, amount integer,
 reason text, status text, completed_at timestamptz, created_by text, phone text, raw_response jsonb, created_at timestamptz default now());
create table payment_attempts(reservation_id uuid, status text, amount integer, phone text, raw_response jsonb, created_at timestamptz default now());
create table reservations(id uuid, restaurant_id uuid, status text, deposit_paid boolean, reserved_for timestamptz);
create table withdrawal_requests(amount integer, status text, net integer, decided_at timestamptz);
create table dining_sessions(id uuid, status text, closed_at timestamptz);
create table dining_guests(session_id uuid, status text);
create function dining_release_tables(uuid) returns void language sql as $$ select; $$;
`;

beforeAll(async () => {
  db = new PGlite(); await db.exec(schema);
  const wallets = migration("0024_wallets.sql");
  await db.exec(wallets.slice(wallets.indexOf("create or replace function public.wallet_credit("), wallets.indexOf("revoke all on function public.wallet_credit")));
  const customerWallet = migration("0051_customer_wallets.sql");
  await db.exec(customerWallet.slice(customerWallet.indexOf("create or replace function public.credit_customer_wallet("), customerWallet.indexOf("create or replace function public.cancel_customer_reservation(")));
  const commercial = migration("0053_commercial_policy.sql");
  await db.exec(commercial.slice(commercial.indexOf("create or replace function public.customer_wallet_pay_order("), commercial.indexOf("revoke all on function public.settle_online_order_payment")));
  await db.exec(migration("0079_platform_funded_loyalty.sql"));
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("truncate loyalty_funding, loyalty_ledger, orders, restaurants, profiles, settings, restaurant_wallets, wallet_ledger, customer_wallets, customer_wallet_ledger, platform_revenue_ledger, order_status_history, refunds, payment_attempts, reservations, withdrawal_requests cascade");
  await db.query("insert into profiles values($1)", [customer]); await db.query("insert into restaurants values($1)", [restaurant]);
  await db.query("insert into customer_wallets(profile_id,balance) values($1,1000)", [customer]);
  await db.query("insert into orders(id,restaurant_id,customer_id,reference,total,loyalty_value,loyalty_points_used) values($1,$2,$3,'CMD-TEST',515,500,100)", [order, restaurant, customer]);
  await db.query("insert into loyalty_ledger(profile_id,restaurant_id,points,kind) values($1,$2,1000,'earn')", [customer, restaurant]);
  await db.query("insert into loyalty_ledger(profile_id,restaurant_id,order_id,points,kind) values($1,$2,$3,-100,'redeem')", [customer, restaurant, order]);
  await db.exec("insert into settings values('loyalty_point_value','5')");
});

describe("platform-funded loyalty accounting", () => {
  it("pays a 1000 FCFA food sale in full when the customer redeems 500 FCFA", async () => {
    expect(await settle()).toMatchObject({ restaurantAmount: 1000, restaurantBalance: 1000 });
    expect(await scalar("select sum(amount)::int as value from wallet_ledger")).toBe(1000);
    expect(await scalar("select amount as value from platform_revenue_ledger")).toBe(15);
    expect(await scalar("select amount as value from loyalty_funding")).toBe(500);
  });
  it("deducts only the customer's discounted payment from their wallet", async () => {
    await db.exec("update orders set payment_method='wallet'");
    expect(await scalar("select customer_wallet_pay_order($1,$2) as value", [customer, order])).toBe(485);
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(1000);
    expect(await scalar("select amount as value from customer_wallet_ledger")).toBe(-515);
  });
  it("funds once under concurrent settlement and later delivery retries", async () => {
    const results = await Promise.all([settle(), settle()]);
    expect(results).toEqual([expect.objectContaining({ alreadySettled: false }), expect.objectContaining({ alreadySettled: true })]);
    await db.exec("update orders set status='delivered'");
    expect(await settle()).toMatchObject({ alreadySettled: true, restaurantAmount: 1000 });
    expect(await scalar("select count(*)::int as value from loyalty_funding")).toBe(1);
    expect(await scalar("select sum(amount)::int as value from wallet_ledger")).toBe(1000);
    await expect(settle(id(5))).rejects.toThrow("order_not_payable");
  });
  it("holds the entire restaurant entitlement until delivery", async () => {
    await settle();
    expect(await scalar("select wallet_refund_hold($1)::int as value", [restaurant])).toBe(1000);
    await db.exec("update orders set status='delivered'");
    expect(await scalar("select wallet_refund_hold($1)::int as value", [restaurant])).toBe(0);
  });
  it("reverses the full restaurant credit but refunds only actual cash and restores points once", async () => {
    await settle(); await cancel(); await cancel();
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(0);
    expect(await scalar("select amount as value from refunds")).toBe(515);
    expect(await scalar("select status as value from refunds")).toBe("pending");
    expect(await scalar("select status as value from loyalty_funding")).toBe("reversed");
    expect(await scalar("select sum(points)::int as value from loyalty_ledger")).toBe(1000);
    expect(await scalar("select count(*)::int as value from loyalty_ledger where kind='refund'")).toBe(1);
    expect(await scalar("select count(*)::int as value from platform_revenue_ledger")).toBe(0);
  });
  it("returns wallet payments to the customer wallet without converting points into cash", async () => {
    await db.exec("update orders set payment_method='wallet'");
    await scalar("select customer_wallet_pay_order($1,$2) as value", [customer, order]);
    await cancel();
    expect(await scalar("select balance as value from customer_wallets")).toBe(1000);
    expect(await scalar("select amount as value from refunds")).toBe(515);
  });
  it("settles and cancels a fully point-funded, zero-cash order", async () => {
    await db.exec("update orders set payment_method='wallet',total=0,service_charge=0,loyalty_value=1000,loyalty_points_used=200; update loyalty_ledger set points=-200 where kind='redeem'");
    await scalar("select customer_wallet_pay_order($1,$2) as value", [customer, order]);
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(1000);
    await cancel();
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(0);
    expect(await scalar("select balance as value from customer_wallets")).toBe(1000);
    expect(await scalar("select count(*)::int as value from refunds")).toBe(0);
    expect(await scalar("select sum(points)::int as value from loyalty_ledger")).toBe(1000);
  });
  it("fully funds the food when only the service charge remains payable", async () => {
    await db.exec("update orders set total=15,loyalty_value=1000,loyalty_points_used=200; update loyalty_ledger set points=-200 where kind='redeem'");
    await settle();
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(1000);
    expect(await scalar("select sum(amount)::int as value from wallet_ledger")).toBe(1000);
  });
  it("restores unpaid reserved points without crediting a restaurant", async () => {
    await db.exec("update orders set status='cancelled'; update orders set status='cancelled'");
    expect(await scalar("select sum(points)::int as value from loyalty_ledger")).toBe(1000);
    expect(await scalar("select count(*)::int as value from loyalty_funding")).toBe(0);
  });
  it("refuses an unproven redemption and rolls back cash credit and paid status", async () => {
    await db.exec("delete from loyalty_ledger where kind='redeem'");
    await expect(settle()).rejects.toThrow("loyalty_redemption_invalid");
    expect(await scalar("select count(*)::int as value from wallet_ledger")).toBe(0);
    expect(await scalar("select is_paid as value from orders")).toBe(false);
  });
  it("keeps cancelled subsidy snapshots immutable", async () => {
    await settle();
    await expect(db.exec("update orders set total=1015")).rejects.toThrow("loyalty_funding_snapshot_changed");
    await cancel();
    await expect(db.exec("update orders set status='confirmed'")).rejects.toThrow("loyalty_funding_snapshot_changed");
  });
  it("repairs historical missing credits and remains safe when migration is rerun", async () => {
    await db.exec("alter table orders disable trigger orders_loyalty_funding; update orders set is_paid=true,status='delivered'; alter table orders enable trigger orders_loyalty_funding");
    await scalar("select wallet_credit($1,500,'payment','Online order CMD-TEST','CMD-TEST') as value", [restaurant]);
    await db.exec(migration("0079_platform_funded_loyalty.sql")); await db.exec(migration("0079_platform_funded_loyalty.sql"));
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(1000);
    expect(await scalar("select count(*)::int as value from loyalty_funding")).toBe(1);
  });
  it("excludes cancelled historical redemptions from repair", async () => {
    await db.exec("alter table orders disable trigger orders_loyalty_funding; update orders set is_paid=true,status='cancelled'; alter table orders enable trigger orders_loyalty_funding");
    await db.exec(migration("0079_platform_funded_loyalty.sql"));
    expect(await scalar("select count(*)::int as value from loyalty_funding")).toBe(0);
  });
  it("aggregates points across customers without negative balances hiding liability", async () => {
    await db.query("insert into profiles values($1)", [id(10)]);
    await db.query("insert into loyalty_ledger(profile_id,points,kind) values($1,-100,'adjust')", [id(10)]);
    expect(await scalar("select admin_loyalty_summary() as value")).toMatchObject({ outstandingPoints: 900, outstandingValue: 4500, pendingRedemptionValue: 500, negativeBalances: 1 });
    await settle();
    expect(await scalar("select admin_loyalty_summary() as value")).toMatchObject({ fundedValue: 500, restaurantBalances: 1000, pendingRedemptionValue: 0 });
  });
  it("does not grant browser roles access to funding or its RPCs", async () => {
    expect(await scalar("select has_table_privilege('anon','loyalty_funding','select') as value")).toBe(false);
    expect(await scalar("select has_function_privilege('authenticated','admin_loyalty_summary()','execute') as value")).toBe(false);
    expect(await scalar("select has_function_privilege('authenticated','fund_order_loyalty(uuid)','execute') as value")).toBe(false);
  });
  it("reports the full food sale without subtracting points or the cash delivery fee", async () => {
    await settle();
    expect((await db.query("select * from manager_sales_summary($1, now()-interval '1 day', now()+interval '1 day')", [restaurant])).rows[0]).toMatchObject({ revenue: 1000 });
    expect((await db.query("select * from manager_sales_series($1, now()-interval '1 day', now()+interval '1 day','day')", [restaurant])).rows[0]).toMatchObject({ revenue: 1000 });
  });
});
