import { describe, expect, it } from "vitest";
import { findPaymentInstruction } from "./notification";

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
});