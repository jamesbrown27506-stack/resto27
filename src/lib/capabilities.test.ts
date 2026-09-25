import { describe, expect, it } from "vitest";
import { BRANCH_ROLES, CAPABILITIES, CAPABILITY_LABEL, can } from "./capabilities";
import { DICTIONARIES, type TranslationKey } from "./i18n/dictionaries";

describe("the branch role matrix", () => {
  it("the kitchen can mark dishes sold out but never cancel (a cancel refunds)", () => {
    expect(can("kitchen", "menu.availability")).toBe(true);
    expect(can("kitchen", "orders.cancel")).toBe(false);
    expect(can("kitchen", "menu.edit")).toBe(false);
  });

  it("taking money at a table is not the power to withdraw it", () => {
    for (const role of ["cashier", "waiter"] as const) {
      expect(can(role, "payments.collect"), role).toBe(true);
      expect(can(role, "finance.manage"), role).toBe(false);
    }
    expect(can("kitchen", "payments.collect")).toBe(false);
  });

  it("the floor staff can seat guests without deciding bookings", () => {
    for (const role of ["cashier", "waiter"] as const) {
      expect(can(role, "reservations.seat"), role).toBe(true);
      expect(can(role, "reservations.decide"), role).toBe(false);
    }
  });

  it("only the owner and the manager can pause the service", () => {
    for (const role of BRANCH_ROLES) {
      expect(can(role, "service.pause"), role).toBe(role === "owner" || role === "manager");
    }
  });

  it("every capability has a label on the staff screen, in both languages", () => {
    for (const capability of CAPABILITIES) {
      expect(CAPABILITY_LABEL[capability]).toBeTruthy();
      const key = `mst.cap.${capability}` as TranslationKey;
      expect(DICTIONARIES.fr[key], key).toBeTruthy();
      expect(DICTIONARIES.en[key], key).toBeTruthy();
    }
  });
});
