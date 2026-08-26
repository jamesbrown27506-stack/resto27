import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Every platform setting, read ONCE per request.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THREE MODULES WERE ASKING THE SAME TABLE THREE SEPARATE TIMES.
 *
 *  `getBranding`, `getAppearance` and `getCartConfig` are each wrapped in
 *  React's `cache()`, so none of them ran twice in a render — that part was
 *  already right. What none of them could see is that the other two exist.
 *  Each selected its own handful of keys from `settings`, so every page on
 *  the platform opened with THREE round trips to one small table before it
 *  rendered a single byte. Measured: `/terms`, a page of static legal prose
 *  with no data of its own, cost one; the homepage's fifteen queries included
 *  three of these.
 *
 *  Deduplication cannot fix that, because the three calls are not duplicates
 *  — they are different queries. Only a shared read can, and that is this.
 *
 *  IT FETCHES THE WHOLE TABLE, ON PURPOSE. The obvious alternative is a union
 *  of the three key lists, which is faster on paper and wrong in practice: it
 *  is a fourth place to remember when a setting is added, and forgetting it
 *  fails silently as a default value rather than loudly as an error. The
 *  whole table is 2.2 KB of key/value pairs — smaller than the HTML of the
 *  page asking for it, and one round trip either way. Correctness that cannot
 *  drift is worth more than the bytes.
 *
 *  FAILS OPEN. A settings outage must not take down every page on the
 *  platform: callers get an empty map and fall back to their own defaults,
 *  which is what they already do when a row is missing. The error goes to the
 *  log so whoever is on call knows why the logo vanished.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const getSettingsMap = cache(async (): Promise<Map<string, string>> => {
  const supabase = createAdminClient();

  const { data, error } = await supabase.from("settings").select("key, value");

  if (error) {
    console.error("[settings] read failed, falling back to defaults —", error.message);
    return new Map();
  }

  return new Map(
    ((data ?? []) as { key: string; value: string | null }[]).map((row) => [
      row.key,
      row.value ?? "",
    ]),
  );
});

/** One setting as text, or the caller's fallback when absent or blank. */
export function settingText(
  map: Map<string, string>,
  key: string,
  fallback: string,
): string {
  const raw = map.get(key)?.trim();
  return raw ? raw : fallback;
}

/** One setting as a number. A missing or unparseable row falls back. */
export function settingNumber(
  map: Map<string, string>,
  key: string,
  fallback: number,
): number {
  const raw = map.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * One setting as a boolean.
 *
 * Only the exact string "true" is true. A settings column is free text, so
 * anything else — "1", "yes", a typo, an empty row — is treated as false
 * rather than guessed at, and the caller's fallback covers the absent case.
 */
export function settingBool(
  map: Map<string, string>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = map.get(key);
  if (raw === undefined || raw === "") return fallback;
  return raw === "true";
}
