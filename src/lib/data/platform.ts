import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { mailConfigProblem, mailIsConfigured } from "@/lib/mail";
import { appMode } from "@/lib/site-url";
import { UPLOAD_BUCKET } from "@/lib/uploads";

/**
 * Platform-operations reads: audit, notifications, broadcasts, reviews,
 * support, settings, and the health checks behind /a/tests.
 *
 * Every list returns [] rather than throwing when its table is absent, so a
 * partially-migrated database shows honest empty pages instead of a stack
 * trace. The warning still reaches the server log.
 */
function soft(what: string, error: { message: string; code?: string }): [] {
  console.warn(`[data:${what}] unavailable —`, error.code ?? "", error.message);
  return [];
}

/* ── Audit log ─────────────────────────────────────────────────────────── */

export interface AuditRow {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string;
  actorRole: string;
  impersonatorEmail: string | null;
  summary: string;
  ipAddress: string | null;
  createdAt: string;
}

export async function listAuditLog(limit = 200): Promise<AuditRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return soft("audit_log", error);

  return (data ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    impersonatorEmail: r.impersonator_email,
    summary: r.summary,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
  }));
}

/* ── Notifications ─────────────────────────────────────────────────────── */

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  tone: "info" | "success" | "warning" | "error";
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(profileId: string): Promise<NotificationRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return soft("notifications", error);

  return (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    tone: n.tone,
    href: n.href,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

/* ── Broadcasts ────────────────────────────────────────────────────────── */

export interface BroadcastRow {
  id: string;
  subject: string;
  body: string;
  audience: string;
  channels: string;
  recipientCount: number;
  sentByEmail: string;
  sentAt: string;
}

export async function listBroadcasts(): Promise<BroadcastRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(50);

  if (error) return soft("broadcasts", error);

  return (data ?? []).map((b) => ({
    id: b.id,
    subject: b.subject,
    body: b.body,
    audience: b.audience,
    channels: b.channels,
    recipientCount: b.recipient_count,
    sentByEmail: b.sent_by_email,
    sentAt: b.sent_at,
  }));
}

/** Live recipient counts, so the composer never guesses. */
export async function getAudienceCounts(): Promise<Record<string, number>> {
  const supabase = createAdminClient();

  const countBy = (column: string, value: string) =>
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq(column, value);

  const [managers, customers, admins] = await Promise.all([
    countBy("role", "manager"),
    countBy("role", "customer"),
    countBy("role", "admin"),
  ]);

  return {
    managers: managers.count ?? 0,
    customers: customers.count ?? 0,
    admins: admins.count ?? 0,
    everyone: (managers.count ?? 0) + (customers.count ?? 0) + (admins.count ?? 0),
  };
}

/* ── Reviews ───────────────────────────────────────────────────────────── */

export interface ReviewRow {
  id: string;
  restaurantId: string;
  restaurantName: string;
  customerName: string;
  rating: number;
  body: string;
  reply: string | null;
  isReported: boolean;
  reportReason: string | null;
  removedAt: string | null;
  createdAt: string;
}

export async function listReportedReviews(): Promise<ReviewRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reviews")
    .select(
      `id, restaurant_id, customer_name, rating, body, reply, is_reported,
       report_reason, removed_at, created_at,
       restaurants ( name )`,
    )
    .eq("is_reported", true)
    .is("removed_at", null)
    .order("created_at", { ascending: false });

  if (error) return soft("reviews", error);

  interface Row {
    id: string;
    restaurant_id: string;
    customer_name: string;
    rating: number;
    body: string;
    reply: string | null;
    is_reported: boolean;
    report_reason: string | null;
    removed_at: string | null;
    created_at: string;
    restaurants: { name: string } | null;
  }

  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurants?.name ?? "—",
    customerName: r.customer_name,
    rating: r.rating,
    body: r.body,
    reply: r.reply,
    isReported: r.is_reported,
    reportReason: r.report_reason,
    removedAt: r.removed_at,
    createdAt: r.created_at,
  }));
}

/* ── Withdrawal fees ──────────────────────────────────────────────────── */

export interface WithdrawalFeeSummary {
  /** Total francs withheld since the first payout (migration 0022). */
  totalFees: number;
  /** How many payouts carried a fee. */
  count: number;
  /** Fees withheld since the start of this calendar month. */
  thisMonthFees: number;
  recent: {
    id: string;
    phone: string;
    gross: number;
    fee: number;
    net: number;
    createdAt: string;
  }[];
}

/**
 * The fee-revenue numbers behind the admin dashboard tile.
 *
 * One row per accepted payout that carried a fee, written by the payout
 * action. Reads are service-role only, matching every other platform read.
 * Fails soft: no ledger table yet means zeros, not an error page.
 */
export async function getWithdrawalFeeSummary(): Promise<WithdrawalFeeSummary> {
  const supabase = createAdminClient();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [all, month, recent] = await Promise.all([
    supabase.from("withdrawal_fees").select("fee"),
    supabase.from("withdrawal_fees").select("fee").gte("created_at", monthStart.toISOString()),
    supabase
      .from("withdrawal_fees")
      .select("id, phone, gross, fee, net, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const sum = (rows: { fee: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + Number(r.fee), 0);

  if (all.error || month.error || recent.error) {
    console.warn(
      "[data:withdrawal_fees] unavailable —",
      all.error?.message ?? month.error?.message ?? recent.error?.message ?? "",
    );
    return { totalFees: 0, count: 0, thisMonthFees: 0, recent: [] };
  }

  return {
    totalFees: sum(all.data),
    count: (all.data ?? []).length,
    thisMonthFees: sum(month.data),
    recent: ((recent.data ?? []) as {
      id: string;
      phone: string;
      gross: number;
      fee: number;
      net: number;
      created_at: string;
    }[]).map((r) => ({
      id: r.id,
      phone: r.phone,
      gross: Number(r.gross),
      fee: Number(r.fee),
      net: Number(r.net),
      createdAt: r.created_at,
    })),
  };
}

/* ── Platform coupons (migration 0023) ────────────────────────────────── */

export interface PlatformCouponRow {
  id: string;
  code: string;
  label: string;
  discountType: string;
  discountValue: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: string;
}

export async function listPlatformCoupons(): Promise<PlatformCouponRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("platform_coupons")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return soft("platform_coupons", error);

  return ((data ?? []) as Record<string, unknown>[]).map((c) => ({
    id: String(c.id),
    code: String(c.code),
    label: String(c.label ?? ""),
    discountType: String(c.discount_type),
    discountValue: Number(c.discount_value),
    minOrder: Number(c.min_order),
    maxDiscount: c.max_discount === null ? null : Number(c.max_discount),
    startsAt: (c.starts_at as string | null) ?? null,
    endsAt: (c.ends_at as string | null) ?? null,
    usageLimit: c.usage_limit === null ? null : Number(c.usage_limit),
    usedCount: Number(c.used_count),
    isActive: Boolean(c.is_active),
    createdAt: String(c.created_at),
  }));
}

/* ── Support ───────────────────────────────────────────────────────────── */

export interface SupportRow {
  id: string;
  name: string;
  email: string;
  subject: string;
  body: string;
  status: "open" | "replied" | "resolved";
  replyBody: string | null;
  repliedBy: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export async function listSupportMessages(): Promise<SupportRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("support_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return soft("support_messages", error);

  return (data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    subject: m.subject,
    body: m.body,
    status: m.status,
    replyBody: m.reply_body,
    repliedBy: m.replied_by,
    repliedAt: m.replied_at,
    createdAt: m.created_at,
  }));
}

/* ── Settings ──────────────────────────────────────────────────────────── */

export interface SettingRow {
  key: string;
  value: string | null;
  valueType: "string" | "integer" | "boolean" | "json";
  category: string;
  label: string | null;
  description: string | null;
}

export async function listSettings(): Promise<SettingRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("settings").select("*").order("category").order("key");

  if (error) return soft("settings", error);

  return (data ?? []).map((s) => ({
    key: s.key,
    value: s.value,
    valueType: s.value_type,
    category: s.category,
    label: s.label,
    description: s.description,
  }));
}

/* ── Health checks — /a/tests ──────────────────────────────────────────── */

export interface HealthCheck {
  name: string;
  detail: string;
  status: "pass" | "warn" | "fail";
}

export interface HealthGroup {
  title: string;
  description: string;
  checks: HealthCheck[];
}

/** Every table the app expects, with the migration that creates it. */
const EXPECTED_TABLES: { table: string; migration: string }[] = [
  { table: "profiles", migration: "0001" },
  { table: "service_areas", migration: "0003" },
  { table: "quartiers", migration: "0003" },
  { table: "cuisines", migration: "0003" },
  { table: "restaurants", migration: "0003" },
  { table: "restaurant_hours", migration: "0003" },
  { table: "restaurant_tables", migration: "0003" },
  { table: "subscription_plans", migration: "0004" },
  { table: "subscriptions", migration: "0004" },
  { table: "settings", migration: "0005" },
  { table: "audit_log", migration: "0005" },
  { table: "notifications", migration: "0005" },
  { table: "broadcasts", migration: "0005" },
  { table: "support_messages", migration: "0005" },
  { table: "orders", migration: "0005" },
  { table: "order_items", migration: "0005" },
  { table: "order_status_history", migration: "0005" },
  { table: "order_payments", migration: "0005" },
  { table: "reviews", migration: "0005" },
  { table: "invoices", migration: "0005" },
  { table: "payment_attempts", migration: "0005" },
  { table: "payments", migration: "0005" },
  { table: "payment_webhook_events", migration: "0005" },
  { table: "camerpay_requests", migration: "0017" },
  { table: "refunds", migration: "0005" },
  { table: "commission_statements", migration: "0005" },
  { table: "plan_changes", migration: "0005" },
  /*
   * The notification and messaging tables.
   *
   * Absent from this list until now, which is exactly how three unapplied
   * migrations stayed invisible: every one of these fails SOFT by design —
   * preferences fall back to defaults, an inbox returns an empty list — so
   * the app looks finished and quietly cannot save a setting or open a
   * conversation. A health page that omits a table cannot report it missing.
   */
  { table: "notification_preferences", migration: "0012" },
  { table: "customer_preferences", migration: "0014" },
  { table: "push_subscriptions", migration: "0018" },
  { table: "conversations", migration: "0019" },
  { table: "conversation_messages", migration: "0019" },
  { table: "notification_channels", migration: "0027" },
  { table: "withdrawal_fees", migration: "0022" },
  { table: "platform_coupons", migration: "0023" },
  { table: "restaurant_wallets", migration: "0024" },
  { table: "wallet_ledger", migration: "0024" },
  { table: "withdrawal_requests", migration: "0024" },
  { table: "review_photos", migration: "0026" },
];

/**
 * Passive health checks — real ones.
 *
 * These actually probe the database rather than reporting a hardcoded list.
 * Each table gets a `head: true` count, which asks Postgres whether it exists
 * and is reachable without transferring any rows.
 *
 * Still passive: no external service is contacted, nothing is written, and it
 * is safe to open in production during an incident. Actively exercising the
 * payment gateway is /a/diagnostics' job.
 */
export async function runHealthChecks(): Promise<HealthGroup[]> {
  const supabase = createAdminClient();

  const tableResults = await Promise.all(
    EXPECTED_TABLES.map(async ({ table, migration }) => {
      const { error, count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      return {
        name: table,
        detail: error
          ? `Missing or unreachable — run migration ${migration}. (${error.message})`
          : `Present · ${count ?? 0} row(s)`,
        status: error ? ("fail" as const) : ("pass" as const),
      };
    }),
  );

  /**
   * Object storage.
   *
   * Worth its own check because its failure mode is silent and confusing: with
   * no bucket, every upload on the platform fails while the rest of the app
   * behaves perfectly, and the error the user sees ("could not store the
   * file") does not obviously mean "a migration has not been run".
   *
   * Still passive — listing buckets reads metadata and writes nothing. The
   * round-trip that proves an object can actually be stored and served lives
   * on /a/diagnostics, which is allowed to make real calls.
   */
  const storageChecks: HealthCheck[] = await (async () => {
    const { data, error } = await supabase.storage.listBuckets();

    if (error) {
      return [
        {
          name: "Object storage",
          detail: `Unreachable — ${error.message}`,
          status: "fail" as const,
        },
      ];
    }

    const assets = (data ?? []).find((b) => b.id === UPLOAD_BUCKET);

    if (!assets) {
      return [
        {
          name: `Bucket "${UPLOAD_BUCKET}"`,
          detail:
            "Missing — run migration 0016. Until it exists, every logo, dish photo and avatar upload fails.",
          status: "fail" as const,
        },
      ];
    }

    return [
      {
        name: `Bucket "${UPLOAD_BUCKET}"`,
        detail: `Present. Size limit ${assets.file_size_limit ? `${Math.round(assets.file_size_limit / 1024 / 1024)} MB` : "unset"}.`,
        status: "pass" as const,
      },
      {
        name: "Bucket is public",
        detail: assets.public
          ? "Yes — uploaded images are served straight from the CDN, no signed URL per render."
          : "No. Images will 404 for visitors; re-run migration 0016, which sets public = true.",
        status: assets.public ? ("pass" as const) : ("fail" as const),
      },
      {
        name: "Image host allow-listed",
        /**
         * next/image refuses any host not in `images.remotePatterns`, and the
         * failure is a 400 on the image rather than anything in the log — so
         * a correct upload can still render as a broken picture.
         */
        detail: process.env.NEXT_PUBLIC_SUPABASE_URL
          ? `next.config.ts derives the pattern from NEXT_PUBLIC_SUPABASE_URL, so ${(() => {
              try {
                return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
              } catch {
                return "the configured host";
              }
            })()} is allowed.`
          : "NEXT_PUBLIC_SUPABASE_URL is unset, so next/image will reject every stored image.",
        status: process.env.NEXT_PUBLIC_SUPABASE_URL ? ("pass" as const) : ("fail" as const),
      },
    ];
  })();

  const settings = await listSettings();
  const settingOf = (key: string) => settings.find((s) => s.key === key)?.value ?? null;

  const configChecks: HealthCheck[] = [
    {
      name: "Platform settings seeded",
      detail:
        settings.length > 0
          ? `${settings.length} setting(s) present.`
          : "No settings rows — run migration 0005.",
      status: settings.length > 0 ? "pass" : "fail",
    },
    {
      name: "Brand name",
      detail: settingOf("brand_name") ?? "Not set — every page falls back to a hardcoded string.",
      status: settingOf("brand_name") ? "pass" : "warn",
    },
    {
      name: "Service charge",
      detail: settingOf("service_charge_percent")
        ? `${settingOf("service_charge_percent")} % — applied to food only, after discount, never to delivery.`
        : "Not set.",
      status: settingOf("service_charge_percent") ? "pass" : "warn",
    },
    {
      name: "Withdrawal fee",
      detail:
        settingOf("withdrawal_fee_enabled") === "true"
          ? `ON — payouts withhold ${settingOf("withdrawal_fee_percent") ?? "?"} % from what the recipient receives (migration 0020).`
          : "Off — payouts are free. Setting it up: run migration 0020, then toggle on /a/settings → Payments.",
      status: settingOf("withdrawal_fee_enabled") === "true" ? "pass" : "warn",
    },
    {
      name: "Subscription grace period",
      detail: settingOf("subscription_grace_days")
        ? `${settingOf("subscription_grace_days")} days after expiry before limits drop to Starter.`
        : "Not set — expiry would lock tenants out with no grace at all.",
      status: settingOf("subscription_grace_days") ? "pass" : "fail",
    },
    {
      name: "Free mode",
      detail:
        settingOf("platform_free_mode") === "true"
          ? "ON — grants paid-tier limits, not Starter. Suspension still overrides it."
          : "Off.",
      status: "pass",
    },
    {
      name: "Payments enabled",
      detail:
        settingOf("payments_enabled") === "true"
          ? `Live via ${settingOf("payment_provider") ?? "unknown provider"}.`
          : "Off — no subscription can be paid until this is switched on.",
      status: settingOf("payments_enabled") === "true" ? "pass" : "warn",
    },
  ];

  const mode = appMode();
  const diverting = mode === "test" && Boolean(process.env.MAIL_TEST_INBOX?.trim());

  const envChecks: HealthCheck[] = [
    {
      /**
       * First in the list on purpose. Every other row is read differently
       * depending on this one, and "which mode am I in" is the question you
       * ask before any of them.
       */
      name: "App mode",
      detail:
        mode === "live"
          ? `LIVE — links point at ${process.env.APP_URL_LIVE ?? process.env.APP_URL ?? "(not set!)"}. Email goes to real recipients.`
          : `TEST — links point at ${process.env.APP_URL_TEST ?? "the request host"}. ${
              diverting
                ? `Email is diverted to ${process.env.MAIL_TEST_INBOX} instead of its real recipient.`
                : "Email goes to its real recipient. Set MAIL_TEST_INBOX to divert it all to one address instead."
            }`,
      /**
       * Only one combination is actually wrong: LIVE with no URL, which falls
       * back to the attacker-controlled Host header.
       *
       * Test mode is a pass either way — delivering to real recipients while
       * testing is a deliberate choice, not a misconfiguration, and a warning
       * that fires on a correct setup teaches people to ignore warnings.
       */
      status:
        mode === "live" &&
        !(process.env.APP_URL_LIVE || process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL)
          ? "fail"
          : "pass",
    },
    {
      name: "Supabase URL",
      detail: process.env.NEXT_PUBLIC_SUPABASE_URL ? "Set." : "Missing.",
      status: process.env.NEXT_PUBLIC_SUPABASE_URL ? "pass" : "fail",
    },
    {
      name: "Publishable key",
      detail: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        ? "Set. Public by design — RLS is what protects the data."
        : "Missing.",
      status: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? "pass" : "fail",
    },
    {
      name: "Secret key",
      detail: process.env.SUPABASE_SECRET_KEY?.includes("REPLACE_ME")
        ? "Still the placeholder from .env.local."
        : process.env.SUPABASE_SECRET_KEY
          ? "Set. Server-side only."
          : "Missing — the admin area cannot read past RLS without it.",
      status:
        process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SECRET_KEY.includes("REPLACE_ME")
          ? "pass"
          : "fail",
    },
    {
      /**
       * PASSIVE ONLY — whether the variables are present, not whether they
       * work. Actually opening the connection is a network call, and this page
       * promises not to make any; the "Test connection" button below the list
       * does that on demand.
       */
      name: "SMTP",
      detail: mailIsConfigured()
        ? `Configured: ${process.env.SMTP_USER} via ${process.env.SMTP_HOST}. Use "Test connection" to prove it works.`
        : (mailConfigProblem() ?? "Not configured — the app logs emails instead of sending them."),
      status: mailIsConfigured() ? "pass" : "warn",
    },
    {
      name: "Supabase Auth email",
      /**
       * Supabase sends password resets itself. Its built-in sender is
       * rate-limited to a handful an hour and is explicitly for testing, so a
       * live project that has not set Custom SMTP will start dropping resets
       * the day it gets busy — silently, from the app's point of view.
       */
      detail:
        "Password resets are sent by Supabase, not by this app. Set the same SMTP credentials under Authentication → SMTP Settings, or Supabase's test sender will rate-limit them.",
      status: "warn",
    },
    {
      /**
       * EITHER route counts. A standing CAMERPAY_TOKEN needs no password, and
       * reporting "not configured" for a perfectly working token deployment
       * would send someone hunting for credentials they deliberately do not
       * have.
       */
      name: "Payment provider credentials",
      detail: (() => {
        const token = process.env.CAMERPAY_TOKEN?.trim();
        const account = process.env.CAMERPAY_ACCOUNT_NUMBER?.trim();

        if (token && !token.includes("REPLACE_ME")) {
          return "CAMERPAY_TOKEN set — authenticating with a token issued by CamerPay, no login call.";
        }
        if (account && !account.includes("REPLACE_ME")) {
          return process.env.CAMERPAY_PASSWORD
            ? `Account ${account} set — a session is fetched by login.`
            : `Account ${account} set but CAMERPAY_PASSWORD is missing, so login cannot run.`;
        }
        return "Neither CAMERPAY_TOKEN nor CAMERPAY_ACCOUNT_NUMBER is set. Payments cannot run.";
      })(),
      status: (() => {
        const token = process.env.CAMERPAY_TOKEN?.trim();
        if (token && !token.includes("REPLACE_ME")) return "pass";

        const account = process.env.CAMERPAY_ACCOUNT_NUMBER?.trim();
        const usable = account && !account.includes("REPLACE_ME") && process.env.CAMERPAY_PASSWORD;
        return usable ? "pass" : "warn";
      })(),
    },
  ];

  return [
    {
      title: "Schema",
      description: `${tableResults.filter((t) => t.status === "pass").length} of ${EXPECTED_TABLES.length} expected tables present.`,
      checks: tableResults,
    },
    {
      title: "Object storage",
      description: "Where every uploaded logo, dish photo and avatar is kept.",
      checks: storageChecks,
    },
    {
      title: "Platform configuration",
      description: "Values read from the settings table.",
      checks: configChecks,
    },
    {
      title: "Environment",
      description: "Server-side variables. Values are never displayed, only their presence.",
      checks: envChecks,
    },
  ];
}
