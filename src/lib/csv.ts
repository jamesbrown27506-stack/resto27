import "server-only";

/**
 * CSV writer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TWO RULES, BOTH INVISIBLE UNTIL THEY BITE (§9).
 *
 *  1. FORMULA INJECTION. Excel and LibreOffice treat a cell beginning with
 *     `=`, `+`, `-` or `@` as a formula and evaluate it on open. A restaurant
 *     name is attacker-controlled text, so a tenant called
 *     `=cmd|'/c calc'!A0` becomes remote code execution on the machine of
 *     whoever opens the export. Every such cell is prefixed with a tab, which
 *     Excel strips on display but refuses to evaluate.
 *
 *  2. UTF-8 BOM. Without it Excel guesses the codepage and mangles every
 *     accent — "Ndolé" becomes "NdolÃ©". Three bytes at the front fix it, and
 *     every other tool ignores them.
 * ─────────────────────────────────────────────────────────────────────────
 */

const BOM = "﻿";
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/** Quote, escape and neutralise a single cell. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = value instanceof Date ? value.toISOString() : String(value);

  // Neutralise before quoting: prefixing after would sit outside the quotes.
  if (DANGEROUS_PREFIX.test(text)) text = `\t${text}`;

  // RFC 4180: double the quotes, wrap if the value contains a delimiter.
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;

  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(","));
  }

  // CRLF, because that is what Excel expects on Windows and every other tool
  // tolerates.
  return BOM + lines.join("\r\n") + "\r\n";
}

/** A download response with the right headers and a dated filename. */
export function csvResponse(filename: string, body: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}-${stamp}.csv"`,
      // These contain tenant financial data. Never cached, never stored by a
      // proxy between us and the browser.
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
