import { describe, expect, it } from "vitest";
import { contextFromSubject, contextHref, contextSubject, isUntouchedThread } from "./context";

describe("chat context subject fallback", () => {
  it("round-trips an order and a reservation", () => {
    expect(contextFromSubject(contextSubject({ kind: "order", reference: "CMD-4F2A91" }))).toEqual({
      kind: "order",
      id: null,
      reference: "CMD-4F2A91",
    });
    expect(contextFromSubject(contextSubject({ kind: "reservation", reference: "RES-7B2C" }))).toEqual({
      kind: "reservation",
      id: null,
      reference: "RES-7B2C",
    });
  });

  it("ignores a customer's free-text subject", () => {
    expect(contextFromSubject("Problème avec CMD-1234")).toBeNull();
    expect(contextFromSubject("")).toBeNull();
    expect(contextFromSubject(null)).toBeNull();
  });

  it("refuses a prefix that does not match the reference kind", () => {
    expect(contextFromSubject("Commande RES-7B2C")).toBeNull();
    expect(contextFromSubject("Réservation CMD-4F2A91")).toBeNull();
  });
});

describe("contextHref", () => {
  it("links an order per side, and not at all without an id", () => {
    const ref = { kind: "order" as const, id: "o1", reference: "CMD-1" };
    expect(contextHref(ref, "customer")).toBe("/orders/o1");
    expect(contextHref(ref, "staff")).toBe("/m/orders/o1");
    expect(contextHref({ ...ref, id: null }, "customer")).toBeNull();
  });

  it("sends a reservation to the bookings list", () => {
    const ref = { kind: "reservation" as const, id: null, reference: "RES-1" };
    expect(contextHref(ref, "customer")).toBe("/reservations");
    expect(contextHref(ref, "staff")).toBe("/m/reservations");
  });
});

describe("isUntouchedThread", () => {
  it("is true while both timestamps come from the same default", () => {
    const t = "2026-09-25T10:00:00.123456+00:00";
    expect(isUntouchedThread({ created_at: t, last_message_at: t })).toBe(true);
  });

  it("is false once a message moved last_message_at", () => {
    expect(
      isUntouchedThread({
        created_at: "2026-09-25T10:00:00.123456+00:00",
        last_message_at: "2026-09-25T10:00:04.001Z",
      }),
    ).toBe(false);
  });
});
