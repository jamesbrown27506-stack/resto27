import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("database should not be used when the full CamerPay hint is supplied");
  }),
}));

import { confirmTransaction } from "./client";

const PHONE = "690000001";
const AMOUNT = 1015;
const INSTRUCTION =
  "Opération initiée. Le propriétaire du numéro (690000001) doit composer le #150*50*000000*1015# sur son téléphone.";

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function mockReports(transactionBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const action = new Headers(init?.headers).get("action");
      if (action === "transaction") return response(transactionBody);
      if (action === "notification") {
        return response({
          etat: true,
          data: [{ id: 201, date: "2026-09-17T18:23:49.000", title: "CamerPay", message: INSTRUCTION }],
        });
      }
      throw new Error("unexpected CamerPay action " + action);
    }),
  );
}

const hint = {
  phone: PHONE,
  amount: AMOUNT,
  direction: "collect" as const,
  startedAt: "2026-09-17T17:23:49.000Z",
  afterId: 99,
  notificationAfterId: 200,
};

describe("confirmTransaction Orange instructions", () => {
  beforeEach(() => {
    vi.stubEnv("CAMERPAY_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("preserves the USSD instruction while the transaction row is pending", async () => {
    mockReports({
      etat: true,
      data: [
        {
          id: 100,
          numeroClient: PHONE,
          montant: AMOUNT,
          action: "RETRAIT_ORANGE",
          used: false,
          ref: null,
        },
      ],
    });

    const result = await confirmTransaction("tracking-id", hint);

    expect(result.status).toBe("pending");
    expect(result.instruction).toMatchObject({ id: 201, code: "#150*50*000000*1015#" });
  });

  it("still returns the instruction when CamerPay's transaction report is unavailable", async () => {
    mockReports({ etat: false, message: "Bad gateway" });

    const result = await confirmTransaction("tracking-id", hint);

    expect(result.status).toBe("pending");
    expect(result.instruction?.code).toBe("#150*50*000000*1015#");
  });
});
