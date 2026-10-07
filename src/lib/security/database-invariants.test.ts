import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

// An isolated PostgreSQL engine executes the migration itself. No live data or
// payment provider is involved. PGlite serializes requests on one connection.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), delegate = id(2), customer = id(3), restaurant = id(4), account = id(5), menu = id(6), promo = id(7);
let db: PGlite;
const schema = `
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create table profiles(id uuid primary key, auth_user_id uuid, status text default 'active', role text default 'customer', deleted_at timestamptz);
create table restaurants(id uuid primary key, owner_id uuid, parent_id uuid, status text default 'active');
create table restaurant_staff(restaurant_id uuid, profile_id uuid, role text, status text default 'active');
create table withdrawal_permissions(restaurant_id uuid, profile_id uuid, daily_limit integer);
create table payout_accounts(id uuid primary key, account_id uuid, phone text, removed_at timestamptz);
create table restaurant_wallets(restaurant_id uuid primary key, balance integer, updated_at timestamptz);
create table wallet_ledger(id uuid default gen_random_uuid(), restaurant_id uuid, amount integer, kind text, note text, reference text);
create table withdrawal_requests(id uuid primary key default gen_random_uuid(), restaurant_id uuid, requested_by uuid,
  amount integer, phone text, note text, recipient_name text, requester_role text, payout_account_id uuid,
  status text default 'pending', requested_at timestamptz default now(), decided_at timestamptz, decided_by uuid, reply_to text);
create table orders(id uuid primary key default gen_random_uuid(), restaurant_id uuid, customer_id uuid, status text default 'pending',
  is_paid boolean default false, payment_method text default 'cash', subtotal integer default 10000, total integer default 10000,
  service_charge integer default 0, promo_code text, discount_amount integer default 0, loyalty_points_used integer default 0, reference text default 'TEST');
create table reservations(id uuid primary key, restaurant_id uuid, status text, deposit_paid boolean, reserved_for timestamptz);
create table payment_attempts(reservation_id uuid, status text, amount integer);
create table menu_items(id uuid primary key, restaurant_id uuid, name text default 'Dish', is_available boolean default true,
  track_stock boolean default true, stock_quantity integer default 5, low_stock_threshold integer default 2);
create table order_items(id uuid default gen_random_uuid(), order_id uuid references orders(id) on delete cascade, menu_item_id uuid, quantity integer);
create table promotions(id uuid primary key, restaurant_id uuid, code text default 'ONE', used_count integer default 0,
  usage_limit integer default 1, is_active boolean default true, starts_at timestamptz, ends_at timestamptz, min_order integer default 0);
create table platform_coupons(like promotions including all);
create table promotion_redemptions(promotion_id uuid, order_id uuid references orders(id) on delete cascade, customer_id uuid, amount integer);
create table loyalty_ledger(profile_id uuid, order_id uuid, restaurant_id uuid, points integer, kind text, note text);
create function wallet_credit(p_restaurant_id uuid, p_amount integer, p_kind text, p_note text default null, p_reference text default null)
returns integer language plpgsql as $$ declare b integer; begin
  select balance into b from restaurant_wallets where restaurant_id=p_restaurant_id for update;
  insert into wallet_ledger(restaurant_id,amount,kind,note,reference) values(p_restaurant_id,p_amount,p_kind,p_note,p_reference);
  update restaurant_wallets set balance=balance+p_amount where restaurant_id=p_restaurant_id; return b+p_amount;
end $$;`;
const scalar = async (sql: string, params: unknown[] = []) => (await db.query<{ value: unknown }>(sql, params)).rows[0]?.value;
const request = (amount = 2000) => scalar("select request_withdrawal_secure($1,$2,$3,$4) as value", [restaurant, delegate, amount, account]);
const claim = (requestId: unknown, actor = delegate) => scalar("select claim_withdrawal_secure($1,$2) as value", [requestId, actor]);
async function basket(orderId: string, quantities: number[], coupon = false, points = 0, guest = false) {
  await db.query("insert into orders(id,restaurant_id,customer_id,checkout_finalized,promo_code,discount_amount,loyalty_points_used) values($1,$2,$3,false,$4,$5,$6)", [orderId, restaurant, guest ? null : customer, coupon ? "ONE" : null, coupon ? 100 : 0, points]);
  for (const quantity of quantities) await db.query("insert into order_items(order_id,menu_item_id,quantity) values($1,$2,$3)", [orderId, menu, quantity]);
}
const finalize = (orderId: string, coupon: string | null = null) => scalar("select finalize_checkout_secure($1,$2) as value", [orderId, coupon]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(schema);
  await db.exec(readFileSync(new URL("../../../supabase/migrations/0077_security_invariants.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../../../supabase/migrations/0078_pending_deposit_refund_holds.sql", import.meta.url), "utf8"));
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("truncate account_recovery_grants, customer_uploads, checkout_resource_claims, promotion_redemptions, loyalty_ledger, order_items, orders, reservations, payment_attempts, menu_items, promotions, platform_coupons, wallet_ledger, withdrawal_requests, restaurant_wallets, payout_accounts, withdrawal_permissions, restaurant_staff, restaurants, profiles, auth.users cascade");
  await db.query("insert into profiles(id,auth_user_id,role) values($1,$1,'manager'),($2,$2,'manager'),($3,$3,'customer')", [owner, delegate, customer]);
  await db.query("insert into auth.users(id) values($1),($2),($3)", [owner, delegate, customer]);
  await db.query("insert into restaurants(id,owner_id) values($1,$2)", [restaurant, owner]);
  await db.query("insert into restaurant_staff(restaurant_id,profile_id,role) values($1,$2,'owner'),($1,$3,'manager')", [restaurant, owner, delegate]);
  await db.query("insert into withdrawal_permissions values($1,$2,2000)", [restaurant, delegate]);
  await db.query("insert into payout_accounts(id,account_id,phone) values($1,$2,'237699123456')", [account, restaurant]);
  await db.query("insert into restaurant_wallets(restaurant_id,balance) values($1,10000)", [restaurant]);
  await db.query("insert into menu_items(id,restaurant_id) values($1,$2)", [menu, restaurant]);
  await db.query("insert into promotions(id,restaurant_id) values($1,$2)", [promo, restaurant]);
});

describe("withdrawal transaction invariants", () => {
  it("reserves refund obligations and pending payouts together", async () => {
    await db.query("insert into orders(restaurant_id,is_paid,payment_method,status,total) values($1,true,'wallet','confirmed',8000)", [restaurant]);
    const attempts = await Promise.allSettled([request(), request()]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await scalar("select sum(amount) as value from withdrawal_requests")).toBe(2000);
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(10000);
  });
  it("rechecks the daily cap for an old queued retry", async () => {
    await db.query("update withdrawal_permissions set daily_limit=10000");
    const queued = await request(5000);
    await db.query("update withdrawal_permissions set daily_limit=2000");
    await expect(claim(queued)).rejects.toThrow("withdrawal_daily_limit");
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(10000);
    expect(await scalar("select status as value from withdrawal_requests")).toBe("pending");
  });
  it("rechecks newly created refund obligations before sending", async () => {
    const queued = await request();
    await db.query("insert into orders(restaurant_id,is_paid,payment_method,status,total) values($1,true,'wallet','confirmed',9000)", [restaurant]);
    await expect(claim(queued)).rejects.toThrow("withdrawal_insufficient_balance");
  });
  it("includes future paid reservation deposits in the hold", async () => {
    await db.query("insert into reservations values($1,$2,'confirmed',true,now()+interval '1 day')", [id(20), restaurant]);
    await db.query("insert into payment_attempts values($1,'succeeded',9000)", [id(20)]);
    await expect(request()).rejects.toThrow("withdrawal_insufficient_balance");
  });
  it("keeps a credited deposit reserved while its booking is still awaiting confirmation", async () => {
    await db.query("insert into reservations values($1,$2,'awaiting_payment',true,now()+interval '1 day')", [id(20), restaurant]);
    await db.query("insert into payment_attempts values($1,'succeeded',9000)", [id(20)]);
    await expect(request()).rejects.toThrow("withdrawal_insufficient_balance");
    expect(await scalar("select security_invariants_version() as value")).toBe(78);
  });
  it.each(["membership", "permission", "account", "profile"])("rejects a queued request after %s revocation", async reason => {
    const queued = await request();
    if (reason === "membership") await db.exec("update restaurant_staff set status='suspended' where role='manager'");
    if (reason === "permission") await db.exec("delete from withdrawal_permissions");
    if (reason === "account") await db.exec("update payout_accounts set removed_at=now()");
    if (reason === "profile") await db.query("update profiles set status='suspended' where id=$1", [delegate]);
    await expect(claim(queued)).rejects.toThrow(/withdrawal_not_allowed|withdrawal_account_missing/);
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(10000);
  });
  it("allows one claim and exactly one debit", async () => {
    const queued = await request();
    expect(await Promise.all([claim(queued), claim(queued)])).toEqual([true, false]);
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(8000);
    expect(await scalar("select count(*)::int as value from wallet_ledger where kind='withdrawal'")).toBe(1);
  });
  it("reverses an explicit refusal once and returns the request to pending", async () => {
    const queued = await request(); await claim(queued);
    const release = () => scalar("select release_withdrawal_secure($1,$2,'refused') as value", [queued, delegate]);
    expect(await release()).toBe(true); expect(await release()).toBe(false);
    expect(await scalar("select balance as value from restaurant_wallets")).toBe(10000);
    expect(await scalar("select status as value from withdrawal_requests")).toBe("pending");
  });
  it("prevents the generic wallet debit from bypassing payout controls", async () => {
    await expect(scalar("select wallet_debit($1,1000,'withdrawal',null,'fake') as value", [restaurant])).rejects.toThrow("withdrawal_secure_claim_required");
  });
  it("uses actual payout time and counts all pending reservations toward a delegate cap", async () => {
    const queued = await request();
    await db.exec("update withdrawal_requests set requested_at=now()-interval '3 days'");
    await expect(request(500)).rejects.toThrow("withdrawal_daily_limit");
    await claim(queued);
    await expect(request(500)).rejects.toThrow("withdrawal_daily_limit");
  });
});

describe("checkout resource invariants", () => {
  it("aggregates duplicate lines and rejects overselling without partial writes", async () => {
    await basket(id(30), [5, 5], true);
    await expect(finalize(id(30), promo)).rejects.toThrow("checkout_insufficient_stock");
    expect(await scalar("select stock_quantity as value from menu_items")).toBe(5);
    expect(await scalar("select used_count as value from promotions")).toBe(0);
  });
  it("enforces a one-use coupon across submitted orders and rolls back rejected stock claims", async () => {
    await basket(id(30), [1], true); await basket(id(31), [1], true);
    const outcomes = await Promise.allSettled([finalize(id(30), promo), finalize(id(31), promo)]);
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await scalar("select used_count as value from promotions")).toBe(1);
    expect(await scalar("select stock_quantity as value from menu_items")).toBe(4);
  });
  it("enforces platform coupon limits too", async () => {
    await db.exec("insert into platform_coupons select * from promotions; delete from promotions");
    await basket(id(30), [1], true); await basket(id(31), [1], true);
    await finalize(id(30), promo); await expect(finalize(id(31), promo)).rejects.toThrow("checkout_promo_invalid");
    expect(await scalar("select used_count as value from platform_coupons")).toBe(1);
  });
  it("finalizes once, and returns resources if an uncompleted checkout is deleted", async () => {
    await db.query("insert into loyalty_ledger(profile_id,points,kind) values($1,100,'earn')", [customer]);
    await basket(id(30), [2], true, 100);
    await finalize(id(30), promo); await finalize(id(30), promo);
    expect(await scalar("select stock_quantity as value from menu_items")).toBe(3);
    expect(await scalar("select sum(points)::int as value from loyalty_ledger")).toBe(0);
    await db.query("delete from orders where id=$1", [id(30)]);
    expect(await scalar("select stock_quantity as value from menu_items")).toBe(5);
    expect(await scalar("select used_count as value from promotions")).toBe(0);
    expect(await scalar("select sum(points)::int as value from loyalty_ledger")).toBe(100);
  });
  it("refuses to spend the same loyalty balance twice", async () => {
    await db.query("insert into loyalty_ledger(profile_id,points,kind) values($1,100,'earn')", [customer]);
    await basket(id(30), [1], false, 100); await basket(id(31), [1], false, 100);
    await finalize(id(30)); await expect(finalize(id(31))).rejects.toThrow("checkout_not_enough_points");
    expect(await scalar("select stock_quantity as value from menu_items")).toBe(4);
    expect(await scalar("select sum(points)::int as value from loyalty_ledger")).toBe(0);
  });
  it("preserves guest checkout without allowing guest loyalty redemption", async () => {
    await basket(id(30), [1], false, 0, true); await finalize(id(30));
    await basket(id(31), [1], false, 100, true);
    await expect(finalize(id(31))).rejects.toThrow("checkout_customer_invalid");
  });
});

describe("recovery and upload invariants", () => {
  it("binds recovery to the user and session and consumes it once", async () => {
    await db.query("insert into account_recovery_grants(token_hash,auth_user_id,session_id,expires_at) values('hash',$1,$2,now()+interval '10 minutes')", [customer, id(40)]);
    const consume = (user: string, session: string) => scalar("select consume_recovery_grant('hash',$1,$2) as value", [user, session]);
    expect(await consume(delegate, id(40))).toBe(false);
    expect(await consume(customer, id(41))).toBe(false);
    expect(await Promise.all([consume(customer, id(40)), consume(customer, id(40))])).toEqual([true, false]);
  });
  it("rejects expired recovery grants", async () => {
    await db.query("insert into account_recovery_grants(token_hash,auth_user_id,session_id,expires_at) values('hash',$1,$2,now()-interval '1 minute')", [customer, id(40)]);
    expect(await scalar("select consume_recovery_grant('hash',$1,$2) as value", [customer, id(40)])).toBe(false);
  });
  it("caps upload reservations and checks the actual profile/Auth association", async () => {
    const reserve = (n: number, auth = customer) => db.query("select reserve_customer_upload($1,$2,$3,'reviews',2097152,$4)", [customer, auth, `reviews/${id(n)}.png`, `https://storage.example/${n}`]);
    await expect(reserve(50, delegate)).rejects.toThrow("upload_not_allowed");
    for (let n = 50; n < 69; n++) await reserve(n);
    const results = await Promise.allSettled([reserve(69), reserve(70)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await scalar("select count(*)::int as value from customer_uploads")).toBe(20);
  });
  it("caps total stored bytes even across different days", async () => {
    for (let n = 100; n < 150; n++) await db.query("insert into customer_uploads(object_path,profile_id,kind,bytes,public_url,created_at) values($1,$2,'reviews',2097152,$1,now()-interval '3 days')", [`reviews/${n}.png`, customer]);
    await expect(db.query("select reserve_customer_upload($1,$1,'reviews/new.png','reviews',1,'new')", [customer])).rejects.toThrow("upload_quota");
  });
  it("denies browser roles access to privileged security functions and records", async () => {
    const functions = ["consume_recovery_grant(text,uuid,uuid)", "request_withdrawal_secure(uuid,uuid,integer,uuid,text,text,integer)", "claim_withdrawal_secure(uuid,uuid)", "finalize_checkout_secure(uuid,uuid)", "reserve_customer_upload(uuid,uuid,text,text,integer,text)"];
    for (const fn of functions) {
      expect(await scalar("select has_function_privilege('authenticated',$1,'execute') as value", [fn])).toBe(false);
      expect(await scalar("select has_function_privilege('anon',$1,'execute') as value", [fn])).toBe(false);
      expect(await scalar("select has_function_privilege('service_role',$1,'execute') as value", [fn])).toBe(true);
    }
    expect(await scalar("select has_table_privilege('authenticated','customer_uploads','insert') as value")).toBe(false);
  });
});
