/**
 * "That column (or table) does not exist yet" — the shape a migration that has
 * not been applied takes (see missing-column.test.ts for the two codes).
 *
 *   42703    — Postgres: a SELECT named an unknown column.
 *   PGRST204 — PostgREST: an INSERT/UPDATE body named a column missing from
 *              its schema cache (no Postgres code at all).
 *   42P01 / PGRST200 / PGRST205 — a table or relationship that is not there.
 *
 * With `column`, only a failure mentioning it counts, so an unrelated error
 * is never swallowed as "old schema".
 */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column?: string): boolean {
  if (!error) return false;
  const known = ["42703", "PGRST204", "42P01", "PGRST200", "PGRST205"].includes(error.code ?? "");
  return known && (!column || (error.message ?? "").includes(column));
}
