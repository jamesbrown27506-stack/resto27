import { describe, expect, it } from "vitest";
import { managerRestaurantRejection } from "./restaurant-access";

describe("managerRestaurantRejection", () => {
  it("rejects a manager whose restaurant is suspended", () => {
    expect(managerRestaurantRejection(["suspended"])).toBe("suspended");
  });

  it("keeps an active branch usable when another branch is suspended", () => {
    expect(managerRestaurantRejection(["suspended", "active"])).toBeNull();
  });

  it("keeps a pending-only restaurant out of the manager area", () => {
    expect(managerRestaurantRejection(["pending"])).toBe("pending-manager");
  });

  it("preserves the existing no-branch state", () => {
    expect(managerRestaurantRejection([])).toBeNull();
  });
});
