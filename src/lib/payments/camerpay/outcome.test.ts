import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({
    // The request ledger: only ever touched to record a verdict, never read
    // here because every test supplies the full hint.
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  })),
}));

import { confirmTransaction } from "./client";
import { referenceClaimId, rowClaimIds, rowOutcome, selectReportRow, type ReportRow } from "./match";
import { findPaymentNotification } from "./notification";

/**
 * CamerPay's reports as they stood on 2026-09-30 (the account's own rows, the
 * holder's name removed). These are the shapes `used === true` was wrong about:
 * every one of the first seven is "used", and only three of them moved money.
 */
const ORANGE = "691098999";
const MTN = "679534849";
const OTHER = "679594849";

const DIAL_800 =
  "Aucun retrait Orange de 800 n'a été détecté pour le numéro 691098999.\n\nVeuillez inviter le client à effectuer le retrait en composant le #150*14*307053*656703911*800# (PHARMACIE MOTOS).";
const DIAL_3500 = DIAL_800.replaceAll("800", "3500");
const MTN_PROMPT =
  "Demande de retrait effectue. Le client doit confirmer le retrait en entrant son code secret. Vous recevrez ensuite un sms de confirmation";

const paidOrange = { id: 3028, ref: "CO260930.0949.B50907", numeroClient: ORANGE, montant: 3500, action: "RETRAIT_ORANGE", used: true, reponse: "" };
const paidMtn = { id: 157, ref: "18775677304", numeroClient: MTN, montant: 1000, action: "RETRAIT_MTN", used: true, reponse: MTN_PROMPT };
const paidOut = { id: 3074, ref: "19013835970", numeroClient: MTN, montant: 500, action: "DEPOT_MTN", used: true, reponse: "Dépôt effectué avec succès. Vous recevrez les détails de la transaction par SMS. Merci d'avoir utilisé le service MobileMoney." };
const refusedDial800 = { id: 3088, ref: null, numeroClient: ORANGE, montant: 800, action: "RETRAIT_ORANGE", used: true, reponse: DIAL_800 };
const refusedDial3500 = { id: 3026, ref: null, numeroClient: ORANGE, montant: 3500, action: "RETRAIT_ORANGE", used: true, reponse: DIAL_3500 };
const insufficient = { id: 3051, ref: null, numeroClient: OTHER, montant: 1500, action: "RETRAIT_MTN", used: true, reponse: "Le solde du compte est insuffisant pour effectuer cette transaction" };
const technicalError = { id: 599, ref: null, numeroClient: MTN, montant: 1015, action: "RETRAIT_MTN", used: true, reponse: "Une erreur technique inconnue s'est produite. Si le problème persiste, contactez le service client." };
const failedPayout = { id: 156, ref: null, numeroClient: "693097439", montant: 554, action: "DEPOT_ORANGE", used: true, reponse: "Une erreur technique inconnue s'est produite. Si le problème persiste, contactez le service client." };
const waitingMtn = { id: 3087, ref: null, numeroClient: MTN, montant: 500, action: "RETRAIT_MTN", used: false, reponse: MTN_PROMPT };
const waitingOrangeOld = { id: 151, ref: null, numeroClient: ORANGE, montant: 500, action: "RETRAIT_ORANGE", used: false, reponse: "" };

const RECEIPT_3500 =
  "RETRAIT_ORANGE validé avec succès ✅\n• Vous : 679534849 (COMPTE)\n• Client : 691098999 (CLIENT)\n• Montant : 3500 FCFA\n• Commission : 0 FCFA\n• Solde commission : 0 FCFA\n• Réf. Transaction : CO260930.0949.B50907\n• Votre nouveau solde : 4000 FCFA";
const FAILURE_1500 =
  "Échec : RETRAIT_MTN ❌\n• Vous : 679534849 (COMPTE)\n• Client : 679594849\n• Montant : 1500 FCFA\n• Réf. : 3bc9ef5c-4016-4a2e-b2ad-9fdedc582a14\n• Motif : Le solde du compte est insuffisant pour effectuer cette transaction\nVeuillez communiquer cette référence au service client si le problème persiste.";
const PAYOUT_RECEIPT_500 =
  "DEPOT_MTN validé avec succès ✅\n• Vous : 679534849 (COMPTE)\n• Client : 679534849 (COMPTE)\n• Montant : 500 FCFA\n• Réf. Transaction : 19013835970\n• Votre nouveau solde : 0 FCFA";

describe("rowOutcome — what a report row proves", () => {
  it("counts money only when the operator issued a reference", () => {
    expect(rowOutcome(paidOrange)).toBe("paid");
    expect(rowOutcome(paidMtn)).toBe("paid");
    expect(rowOutcome(paidOut)).toBe("paid");
  });

  it("never reads a finished row without a reference as paid", () => {
    // Settling on `used` marked two orders paid from rows like technicalError.
    expect(rowOutcome(insufficient)).toBe("failed");
    expect(rowOutcome(technicalError)).toBe("failed");
    expect(rowOutcome(failedPayout)).toBe("failed");
  });

  it("reads Orange's refusal as a code to dial, not a payment and not a failure", () => {
    expect(rowOutcome(refusedDial800)).toBe("dial");
    expect(rowOutcome(refusedDial3500)).toBe("dial");
  });

  it("keeps an unanswered request pending", () => {
    expect(rowOutcome(waitingMtn)).toBe("pending");
    expect(rowOutcome(waitingOrangeOld)).toBe("pending");
  });

  it("resolves every doubt away from a payment", () => {
    // Finished, no reference, no words: proof of nothing.
    expect(rowOutcome({ id: 1, used: true, ref: null, reponse: "" })).toBe("pending");
    expect(rowOutcome({ id: 1, used: true, ref: "  ", reponse: "" })).toBe("pending");
    // A reference beside a failure text is not trusted either.
    expect(rowOutcome({ id: 1, used: true, ref: "X1", reponse: "Transaction échouée : solde insuffisant" })).toBe("failed");
    // Not finished is never paid, reference or not.
    expect(rowOutcome({ id: 1, used: false, ref: "X1", reponse: "" })).toBe("pending");
    expect(rowOutcome({ id: 1, used: true, ref: "X1", etat: false })).toBe("failed");
  });
});

describe("selectReportRow — the row a customer-initiated payment settled on", () => {
  const facts = (overrides: Partial<Parameters<typeof selectReportRow>[1]> = {}) => ({
    needle: "723004ee-8c52-488b-94a2-6e4e333fe954",
    phone: ORANGE,
    amount: 800,
    direction: "collect" as const,
    exclude: new Set<string>(),
    ...overrides,
  });

  it("does not mistake the refused ask for the payment (the 2026-09-30 false 'Settled')", () => {
    const rows: ReportRow[] = [refusedDial800, waitingMtn];
    const row = selectReportRow(rows, facts({ afterId: 3087, customerInitiated: true }));
    expect(row?.id).toBe(3088);
    expect(rowOutcome(row!)).toBe("dial");
  });

  it("finds the paid ask behind the refused ones", () => {
    const rows: ReportRow[] = [paidOrange, { ...refusedDial3500, id: 3027 }, refusedDial3500];
    const row = selectReportRow(rows, facts({ amount: 3500, afterId: 3025, customerInitiated: true }));
    expect(row?.id).toBe(3028);
    expect(rowOutcome(row!)).toBe("paid");
  });

  it("leaves a payment alone once another attempt claimed it, by reference or by row id", () => {
    const rows: ReportRow[] = [paidOrange, refusedDial3500];
    const taken = (id: string) =>
      selectReportRow(rows, facts({ amount: 3500, afterId: 3025, customerInitiated: true, exclude: new Set([id]) }))?.id;
    expect(taken(referenceClaimId("CO260930.0949.B50907"))).toBe(3026);
    expect(taken("3028")).toBe(3026);
    expect(rowClaimIds(paidOrange)).toEqual(["ref:CO260930.0949.B50907", "3028"]);
  });
});

describe("findPaymentNotification — receipts", () => {
  const rows = [
    { id: 4372, message: RECEIPT_3500 },
    { id: 4392, message: FAILURE_1500 },
    { id: 4420, message: PAYOUT_RECEIPT_500 },
    { id: 4430, message: MTN_PROMPT },
  ];

  it("settles on the operator's receipt and carries its reference", () => {
    expect(findPaymentNotification(rows, { phone: ORANGE, amount: 3500, afterNotificationId: 4371 })).toMatchObject({
      id: 4372,
      status: "success",
      reference: "CO260930.0949.B50907",
    });
  });

  it("reads an operator failure as a failure", () => {
    expect(findPaymentNotification(rows, { phone: OTHER, amount: 1500, afterNotificationId: 4371 })).toMatchObject({
      id: 4392,
      status: "failed",
    });
  });

  it("ignores a failure notice that names another request", () => {
    const hint = { phone: OTHER, amount: 1500, afterNotificationId: 4371 };
    // The customer's earlier try, published after the new try's counter.
    expect(findPaymentNotification(rows, { ...hint, requestId: "aaaaaaaa-0000-4000-8000-000000000000" })).toBeNull();
    // The request it does name.
    expect(findPaymentNotification(rows, { ...hint, requestId: "3BC9EF5C-4016-4a2e-b2ad-9fdedc582a14" }))
      .toMatchObject({ id: 4392, status: "failed" });
  });

  it("never lets a payout receipt settle a collection, or the reverse", () => {
    expect(findPaymentNotification(rows, { phone: MTN, amount: 500, afterNotificationId: 4371 })).toBeNull();
    expect(
      findPaymentNotification(rows, { phone: MTN, amount: 500, afterNotificationId: 4371, direction: "payout" }),
    ).toMatchObject({ id: 4420, status: "success", reference: "19013835970" });
    expect(
      findPaymentNotification(rows, { phone: ORANGE, amount: 3500, afterNotificationId: 4371, direction: "payout" }),
    ).toBeNull();
  });

  it("skips a receipt whose payment another attempt already claimed by reference", () => {
    expect(
      findPaymentNotification(rows, {
        phone: ORANGE,
        amount: 3500,
        afterNotificationId: 4371,
        excludeIds: [referenceClaimId("CO260930.0949.B50907")],
      }),
    ).toBeNull();
  });

  it("does not read Orange's refusal as a receipt", () => {
    // "effectuer le retrait" used to satisfy the success pattern ("effectu…").
    const refusal = [{ id: 5000, message: DIAL_800 + "\nRéf. Transaction : AUCUNE" }];
    expect(findPaymentNotification(refusal, { phone: ORANGE, amount: 800, afterNotificationId: 4999 })?.status).toBe(
      "instruction",
    );
  });
});

describe("confirmTransaction — the verdict, end to end", () => {
  function mockReports(transactions: unknown[], notifications: unknown[] = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const action = new Headers(init?.headers).get("action");
        const data = action === "transaction" ? transactions : action === "notification" ? notifications : null;
        if (!data) throw new Error("unexpected CamerPay action " + action);
        return Promise.resolve(
          new Response(JSON.stringify({ etat: true, data }), { status: 200, headers: { "content-type": "application/json" } }),
        );
      }),
    );
  }

  const base = { direction: "collect" as const, startedAt: "2026-09-30T13:28:39.000Z" };

  beforeEach(() => {
    vi.stubEnv("CAMERPAY_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("an Orange payment nobody has dialled is PENDING — and hands back the code", async () => {
    // Exactly what the console showed as "Settled — 800 FCFA" on 2026-09-30.
    mockReports([refusedDial800, waitingMtn]);
    const result = await confirmTransaction("723004ee-8c52-488b-94a2-6e4e333fe954", {
      ...base, phone: ORANGE, amount: 800, afterId: 3087, notificationAfterId: 4430, customerInitiated: true,
    });
    expect(result.status).toBe("pending");
    expect(result.rowId).toBeUndefined();
    expect(result.instruction).toMatchObject({
      code: "#150*14*307053*656703911*800#",
      merchantName: "PHARMACIE MOTOS",
      customerInitiated: true,
    });
  });

  it("the same refusal is pending for a caller that does not know about dialling", async () => {
    mockReports([refusedDial800]);
    const result = await confirmTransaction("x", { ...base, phone: ORANGE, amount: 800, afterId: 3087, notificationAfterId: 4430 });
    expect(result.status).toBe("pending");
  });

  it("settles once the customer has dialled, claimed under the operator's reference", async () => {
    mockReports([paidOrange, refusedDial3500], [{ id: 4372, message: RECEIPT_3500 }]);
    const result = await confirmTransaction("x", {
      ...base, phone: ORANGE, amount: 3500, afterId: 3025, notificationAfterId: 4371, customerInitiated: true,
    });
    expect(result).toMatchObject({ status: "success", amount: 3500, rowId: "ref:CO260930.0949.B50907" });
  });

  it("claims the receipt under the SAME identity as the row, so one payment cannot settle twice", async () => {
    // The transaction row has not caught up; the receipt has.
    mockReports([refusedDial3500], [{ id: 4372, message: RECEIPT_3500 }]);
    const viaReceipt = await confirmTransaction("x", {
      ...base, phone: ORANGE, amount: 3500, afterId: 3025, notificationAfterId: 4371, customerInitiated: true,
    });
    expect(viaReceipt).toMatchObject({ status: "success", rowId: "ref:CO260930.0949.B50907" });

    // A second attempt, told that reference is taken, finds nothing to settle from.
    mockReports([paidOrange, refusedDial3500], [{ id: 4372, message: RECEIPT_3500 }]);
    const second = await confirmTransaction("y", {
      ...base, phone: ORANGE, amount: 3500, afterId: 3025, notificationAfterId: 4371, customerInitiated: true,
      excludeRowIds: ["ref:CO260930.0949.B50907"],
    });
    expect(second.status).toBe("pending");
  });

  it("an MTN payment that failed at the operator is FAILED, never paid", async () => {
    // Rows like these settled two orders on 2026-09-17.
    mockReports([technicalError]);
    expect((await confirmTransaction("x", { ...base, phone: MTN, amount: 1015, afterId: 598, notificationAfterId: 1 })).status).toBe("failed");

    mockReports([insufficient], [{ id: 4392, message: FAILURE_1500 }]);
    expect((await confirmTransaction("x", { ...base, phone: OTHER, amount: 1500, afterId: 3050, notificationAfterId: 4391 })).status).toBe("failed");

    // The notice alone, before the row has caught up — and only for the request it names.
    mockReports([{ ...insufficient, used: false, reponse: MTN_PROMPT }], [{ id: 4392, message: FAILURE_1500 }]);
    const notice = { ...base, phone: OTHER, amount: 1500, afterId: 3050, notificationAfterId: 4391 };
    expect((await confirmTransaction("3bc9ef5c-4016-4a2e-b2ad-9fdedc582a14", notice)).status).toBe("failed");
    expect((await confirmTransaction("aaaaaaaa-0000-4000-8000-000000000000", notice)).status).toBe("pending");
  });

  it("an MTN prompt nobody answered is pending, and a paid one settles", async () => {
    mockReports([waitingMtn]);
    expect((await confirmTransaction("x", { ...base, phone: MTN, amount: 500, afterId: 3086, notificationAfterId: 4429 })).status).toBe("pending");

    mockReports([paidMtn]);
    expect(await confirmTransaction("x", { ...base, phone: MTN, amount: 1000, afterId: 156, notificationAfterId: 1 }))
      .toMatchObject({ status: "success", rowId: "ref:18775677304" });
  });

  it("a payout is delivered only with a reference, and failed when the operator says so", async () => {
    const payout = { ...base, direction: "payout" as const };
    mockReports([paidOut]);
    expect(await confirmTransaction("x", { ...payout, phone: MTN, amount: 500, afterId: 3073, notificationAfterId: 4418 }))
      .toMatchObject({ status: "success", rowId: "ref:19013835970" });

    mockReports([failedPayout]);
    expect((await confirmTransaction("x", { ...payout, phone: "693097439", amount: 554, afterId: 155, notificationAfterId: 1 })).status).toBe("failed");
  });
});
