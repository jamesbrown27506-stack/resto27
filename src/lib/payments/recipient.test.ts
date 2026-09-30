import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("the recipient check never touches the database");
  }),
}));

import { identifyRecipient, requireConfirmedRecipient } from "./recipient";

/** CamerPay's answer to IDENTIFIE, and a record of what was asked. */
function mockIdentify(body: unknown, status = 200) {
  const calls: { action: string | null; data: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ action: headers.get("action"), data: JSON.parse(headers.get("DATA") ?? "null") });
      return Promise.resolve(
        typeof body === "string"
          ? new Response(body, { status, headers: { "content-type": "text/html" } })
          : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
      );
    }),
  );
  return calls;
}

// The live answer of 2026-09-30, padding included.
const IDENTIFIED = {
  etat: true,
  message: "Le compte associé au numéro 691098998 appartient à EDOUARD TAHALI.",
  data: { nomClient: " EDOUARD TAHALI" },
};

describe("the recipient check before a withdrawal", () => {
  beforeEach(() => {
    vi.stubEnv("CAMERPAY_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks CamerPay for the holder with the action and field it actually accepts", async () => {
    const calls = mockIdentify(IDENTIFIED);
    expect(await identifyRecipient("+237 691 09 89 98")).toEqual({ ok: true, phone: "691098998", name: "EDOUARD TAHALI" });
    // `identifier` and `{ numero }` are both refused by the live API.
    expect(calls).toEqual([{ action: "IDENTIFIE", data: { numeroClient: "691098998" } }]);
  });

  it("refuses a number that is not one, without asking", async () => {
    const calls = mockIdentify(IDENTIFIED);
    expect(await identifyRecipient("12345")).toEqual({ ok: false, reason: "badPhone" });
    expect(calls).toHaveLength(0);
  });

  it("tells 'no such wallet' from 'could not ask'", async () => {
    mockIdentify({ etat: false, message: "Impossible d'identifier le numéro", data: null }, 404);
    expect(await identifyRecipient("691098998")).toMatchObject({ ok: false, reason: "notIdentified" });

    mockIdentify("<html>Bad gateway</html>", 502);
    expect(await identifyRecipient("691098998")).toMatchObject({ ok: false, reason: "unavailable" });

    // Accepted with no name in it (the deferred shape the docs describe).
    mockIdentify({ etat: true, message: "Votre requête est en cours de traitement.", data: { replyTo: "abc" } });
    expect(await identifyRecipient("691098998")).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("lets a payout through only to the name the sender confirmed", async () => {
    mockIdentify(IDENTIFIED);
    expect(await requireConfirmedRecipient("691098998", "EDOUARD TAHALI")).toEqual({
      ok: true,
      phone: "691098998",
      name: "EDOUARD TAHALI",
    });
  });

  it("refuses when nobody was shown a name — and does not even ask", async () => {
    const calls = mockIdentify(IDENTIFIED);
    expect(await requireConfirmedRecipient("691098998", undefined)).toEqual({ ok: false, reason: "notConfirmed" });
    expect(await requireConfirmedRecipient("691098998", "   ")).toEqual({ ok: false, reason: "notConfirmed" });
    expect(calls).toHaveLength(0);
  });

  it("refuses when the account is in another name than the one confirmed", async () => {
    // The number was edited after the look-up, or the request was forged.
    mockIdentify(IDENTIFIED);
    expect(await requireConfirmedRecipient("691098998", "EMMANUEL FOQUO")).toEqual({
      ok: false,
      reason: "changed",
      name: "EDOUARD TAHALI",
    });
  });

  it("refuses rather than sends when the holder cannot be checked", async () => {
    mockIdentify("<html>Bad gateway</html>", 502);
    expect(await requireConfirmedRecipient("691098998", "EDOUARD TAHALI")).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
