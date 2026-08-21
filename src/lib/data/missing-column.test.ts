import { describe, expect, it } from "vitest";

/**
 * The two shapes of "that column does not exist", pinned.
 *
 * Every migration-tolerance fallback in this codebase hangs off this test, and
 * it exists because checking only 42703 silently disabled all of them on the
 * WRITE path — the path they were written for. A live probe against the
 * database returned:
 *
 *   read  → {"code":"42703",   "message":"column restaurants.deposit_type does not exist"}
 *   write → {"code":"PGRST204","message":"Could not find the 'push_enabled' column
 *            of 'customer_preferences' in the schema cache"}
 *
 * PostgREST refuses the write against its own schema cache before Postgres is
 * ever asked, so there is no Postgres code on it at all.
 *
 * The predicate is duplicated from customer-actions rather than exported from
 * it: that module is "use server", and importing it into a test drags in the
 * whole Supabase admin client and next/cache.
 */
function isMissingColumn(error: { code?: string; message?: string } | null, column: string) {
  if (!error) return false;
  const known = error.code === "42703" || error.code === "PGRST204";
  return known && (error.message ?? "").includes(column);
}

const READ_ERROR = {
  code: "42703",
  message: "column restaurants.deposit_type does not exist",
};

const WRITE_ERROR = {
  code: "PGRST204",
  message:
    "Could not find the 'push_enabled' column of 'customer_preferences' in the schema cache",
};

describe("isMissingColumn", () => {
  it("catches the read shape (Postgres 42703)", () => {
    expect(isMissingColumn(READ_ERROR, "deposit_type")).toBe(true);
  });

  it("catches the write shape (PostgREST PGRST204)", () => {
    // The regression: this returned false while only 42703 was checked, so
    // every write-side retry was dead and the save failed outright.
    expect(isMissingColumn(WRITE_ERROR, "push_enabled")).toBe(true);
  });

  it("does not fire for a different column", () => {
    expect(isMissingColumn(READ_ERROR, "push_enabled")).toBe(false);
    expect(isMissingColumn(WRITE_ERROR, "deposit_type")).toBe(false);
  });

  it("does not swallow unrelated failures", () => {
    // A foreign-key violation names a column too, and retrying without it
    // would be exactly the wrong response.
    expect(
      isMissingColumn(
        {
          code: "23503",
          message: 'Key (profile_id)=(…) is not present in table "profiles". push_enabled',
        },
        "push_enabled",
      ),
    ).toBe(false);
    expect(isMissingColumn({ code: "23514", message: "deposit_type check" }, "deposit_type")).toBe(
      false,
    );
  });

  it("is false for no error at all", () => {
    expect(isMissingColumn(null, "anything")).toBe(false);
  });
});
