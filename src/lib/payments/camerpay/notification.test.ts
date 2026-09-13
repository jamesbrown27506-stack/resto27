import { describe, expect, it } from "vitest";
import { findPaymentInstruction, findPaymentNotification, notificationRowId } from "./notification";

describe("findPaymentInstruction", () => {
  it("extracts the exact code from a matching post-request Orange notification", () => {
    const result = findPaymentInstruction(
      [
        {
          id: 152,
          date: "2026-09-13T12:12:32.000",
          numero: "679000000",
          title: "CamerPay",
          message:
            "Opération initiée. Le propriétaire du numéro (691 000 000) doit composer le #150**14*123456**654321000**500# sur son téléphone.",
        },
      ],
      { phone: "691000000", amount: 500, afterNotificationId: 151 },
    );

    expect(result).toEqual({
      id: 152,
      date: "2026-09-13T12:12:32.000",
      message:
        "Opération initiée. Le propriétaire du numéro (691 000 000) doit composer le #150**14*123456**654321000**500# sur son téléphone.",
      code: "#150**14*123456**654321000**500#",
    });
  });

  it("ignores the envelope number and rejects stale or different transactions", () => {
    const rows = [
      {
        id: 150,
        numero: "691000000",
        message: "Composer le #150**14*111**500# pour le numéro 691000000.",
      },
      {
        id: 153,
        numero: "679000000",
        message: "Composer le #150**14*222**2000# pour le numéro 691000000.",
      },
    ];

    expect(
      findPaymentInstruction(rows, {
        phone: "691000000",
        amount: 500,
        afterNotificationId: 151,
      }),
    ).toBeNull();
  });

  it("treats a matching Orange receipt as a final success, not a USSD instruction", () => {
    const rows = [
      {
        id: 149,
        message: "Composer le #150**14*111**500# pour le numéro 691098999.",
      },
      {
        id: 152,
        date: "2026-09-13T14:19:31.000",
        message:
          "RETRAIT_ORANGE validé avec succès ✅ • Vous : 679534849 • Client : 691098999 • Montant : 500 FCFA • Commission : 0 FCFA • Réf. Transaction : CO260913.1418.A73075 • Votre nouveau solde : 3000 FCFA",
      },
    ];

    expect(
      findPaymentNotification(rows, {
        phone: "691098999",
        amount: 500,
        afterNotificationId: 150,
      }),
    ).toMatchObject({ id: 152, status: "success" });

    expect(
      findPaymentInstruction(rows, {
        phone: "691098999",
        amount: 500,
        afterNotificationId: 150,
      }),
    ).toBeNull();
  });

  it("does not accept a stale success receipt from before this request", () => {
    expect(
      findPaymentNotification(
        [{
          id: 150,
          message:
            "RETRAIT_ORANGE validé avec succès. Client : 691098999. Montant : 500 FCFA. Réf. Transaction : CO1",
        }],
        { phone: "691098999", amount: 500, afterNotificationId: 150 },
      ),
    ).toBeNull();
  });
});

/**
 * The notification report as it stood on 2026-09-13 (numbers replaced): a
 * paid 14:17 Orange collection, then two unpaid retries for the same number
 * and amount, and an earlier payout receipt to the same number.
 */
const CUSTOMER = "691098999";
const instruction = (id: number, amount = 500) => ({
  id,
  title: "CamerPay",
  message: `Opération initiée pour le point de vente BERI NFORMI.\nLe propriétaire du numéro (${CUSTOMER}) doit composer le #150*14*948457*680000078*${amount}# sur son téléphone pour finaliser la transaction.`,
});
const SEPT_13 = [
  {
    id: 148,
    title: "OrangeMoney",
    message: `DEPOT_ORANGE validé avec succès ✅\n• Vous : 679534849\n• Client : ${CUSTOMER}\n• Montant : 500 FCFA\n• Réf. Transaction : CI260913.1203.C42087\n• Votre nouveau solde : 500 FCFA`,
  },
  instruction(159, 2000),
  instruction(160),
  {
    id: 161,
    title: "OrangeMoney",
    message: `RETRAIT_ORANGE validé avec succès ✅\n• Vous : 679534849\n• Client : ${CUSTOMER}\n• Montant : 500 FCFA\n• Commission : 0 FCFA\n• Réf. Transaction : CO260913.1418.A73075\n• Votre nouveau solde : 3000 FCFA`,
  },
  instruction(162),
  instruction(163),
];

describe("one request among its retries", () => {
  it("settles the paid collection even after later retries left newer instructions", () => {
    // The 14:17 request captured counter 159: its instruction is #160, its receipt #161.
    expect(findPaymentNotification(SEPT_13, { phone: CUSTOMER, amount: 500, afterNotificationId: 159 }))
      .toMatchObject({ id: 161, status: "success" });
  });

  it("keeps an unpaid retry pending on its own instruction, never the earlier receipt", () => {
    // The 14:23 retry captured counter 161: #162 is its instruction, #163 the next retry's.
    expect(findPaymentNotification(SEPT_13, { phone: CUSTOMER, amount: 500, afterNotificationId: 161 }))
      .toMatchObject({ id: 162, status: "instruction" });
  });

  it("never reads a payout receipt to the same number and amount as a collection", () => {
    expect(findPaymentNotification(SEPT_13.slice(0, 1), { phone: CUSTOMER, amount: 500, afterNotificationId: 100 }))
      .toBeNull();
  });

  it("leaves a receipt another attempt already settled from", () => {
    expect(
      findPaymentNotification(SEPT_13, {
        phone: CUSTOMER,
        amount: 500,
        afterNotificationId: 159,
        excludeIds: [notificationRowId(161)],
      }),
    ).toMatchObject({ id: 160, status: "instruction" });
  });

  it("never mistakes our own account number on a receipt for the customer", () => {
    // Every receipt carries "Vous : <our account>". On 2026-09-13 two MTN tests
    // paid from the account's own number were matched to receipt #161, which
    // a different customer paid by Orange.
    expect(findPaymentNotification(SEPT_13, { phone: "679534849", amount: 500, afterNotificationId: 159 }))
      .toBeNull();
  });

  it("reads the labelled amount, not the balance or the commission", () => {
    const receipt = {
      id: 200,
      message: `RETRAIT_MTN validé avec succès ✅\n• Vous : 679534849\n• Client : ${CUSTOMER}\n• Montant : 2 000 FCFA\n• Commission : 0 FCFA\n• Réf. Transaction : 18000007613\n• Votre nouveau solde : 500 FCFA`,
    };
    expect(findPaymentNotification([receipt], { phone: CUSTOMER, amount: 2000, afterNotificationId: 100 }))
      .toMatchObject({ id: 200, status: "success" });
    expect(findPaymentNotification([receipt], { phone: CUSTOMER, amount: 500, afterNotificationId: 100 }))
      .toBeNull();
  });

  it("does not take a 2000 FCFA instruction for a 500 FCFA request", () => {
    expect(findPaymentNotification(SEPT_13, { phone: CUSTOMER, amount: 2000, afterNotificationId: 158 }))
      .toMatchObject({ id: 159, status: "instruction" });
  });
});
