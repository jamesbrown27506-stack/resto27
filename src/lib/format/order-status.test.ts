import { describe, expect, it } from "vitest";
import {
  ORDER_FLOW,
  ORDER_STATUS_META,
  ORDER_STATUSES,
  advanceLabel,
  canCustomerCancel,
  hasRestaurantActions,
  isTerminal,
  nextStatus,
} from "./order-status";

/**
 * `awaiting_customer` decides whether a kitchen starts cooking, so the exact
 * shape of the transition out of it is the thing worth pinning.
 *
 * The state exists because quoting a delivery fee used to confirm the order in
 * the same move: the total rose without the customer agreeing, AND the kitchen
 * began. A customer refusing the price was refusing food already made. If a
 * restaurant could advance past this state, both faults come straight back.
 */

describe("nextStatus", () => {
  it("gives the restaurant NO move at awaiting_customer", () => {
    // The single most important assertion in this file. The only ways out are
    // the customer accepting (→ confirmed) or declining (→ cancelled), and
    // advanceOrder refuses it server-side for the same reason.
    expect(nextStatus("awaiting_customer")).toBeNull();
  });

  it("sends pending to confirmed, not through the new state", () => {
    // ORDER_FLOW lists awaiting_customer between the two so the customer's
    // timeline can show it, but advancing is not how you get there —
    // advanceOrder routes a delivery order with a fee above zero into it.
    expect(nextStatus("pending")).toBe("confirmed");
  });

  it("leaves the rest of the chain alone", () => {
    expect(nextStatus("confirmed")).toBe("preparing");
    expect(nextStatus("preparing")).toBe("shipped");
    expect(nextStatus("shipped")).toBe("delivered");
  });

  it("is null at every terminal state", () => {
    expect(nextStatus("delivered")).toBeNull();
    expect(nextStatus("cancelled")).toBeNull();
  });
});

describe("advanceLabel", () => {
  it("offers no button at awaiting_customer", () => {
    // A button here would be the restaurant agreeing to a price on the
    // customer's behalf.
    expect(advanceLabel("awaiting_customer")).toBeNull();
  });

  it("still labels every step the restaurant does own", () => {
    expect(advanceLabel("pending")).toBe("Confirmer");
    expect(advanceLabel("confirmed")).toBe("Commencer");
    expect(advanceLabel("preparing")).toBe("Envoyer");
    expect(advanceLabel("shipped")).toBe("Marquer livrée");
    expect(advanceLabel("delivered")).toBeNull();
  });
});

describe("canCustomerCancel", () => {
  it("lets a customer out while the fee is still theirs to refuse", () => {
    expect(canCustomerCancel("awaiting_customer")).toBe(true);
  });

  it("still stops once the kitchen has committed", () => {
    expect(canCustomerCancel("pending")).toBe(true);
    expect(canCustomerCancel("confirmed")).toBe(true);
    expect(canCustomerCancel("preparing")).toBe(false);
    expect(canCustomerCancel("shipped")).toBe(false);
    expect(canCustomerCancel("delivered")).toBe(false);
  });
});

describe("hasRestaurantActions", () => {
  it("shows the cluster wherever there is a step to take", () => {
    expect(hasRestaurantActions("pending", true)).toBe(true);
    expect(hasRestaurantActions("confirmed", true)).toBe(true);
    expect(hasRestaurantActions("shipped", true)).toBe(true);
  });

  it("shows it at awaiting_customer even without the capability", () => {
    // There is no advance button in that state on purpose — what renders is
    // the notice telling the kitchen not to start. Hiding the whole cluster
    // would hide the explanation with it.
    expect(hasRestaurantActions("awaiting_customer", false)).toBe(true);
  });

  it("hides it once the order is finished", () => {
    expect(hasRestaurantActions("delivered", true)).toBe(false);
    expect(hasRestaurantActions("cancelled", true)).toBe(false);
  });

  it("hides it from someone who cannot advance", () => {
    // A waiter without orders.advance gets no buttons rather than buttons the
    // server would refuse.
    expect(hasRestaurantActions("pending", false)).toBe(false);
    expect(hasRestaurantActions("confirmed", false)).toBe(false);
  });
});

describe("the catalogue stays whole", () => {
  it("gives every status display metadata", () => {
    // A status without a meta entry renders as a blank badge rather than
    // failing loudly, which is how one gets missed.
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_META[status], status).toBeDefined();
      expect(ORDER_STATUS_META[status].label.length).toBeGreaterThan(0);
    }
  });

  it("keeps awaiting_customer in the customer's timeline", () => {
    // In the flow, not beside it: "a step is waiting on you" belongs on the
    // timeline the customer reads.
    expect(ORDER_FLOW).toContain("awaiting_customer");
    expect(ORDER_FLOW.indexOf("awaiting_customer")).toBe(
      ORDER_FLOW.indexOf("confirmed") - 1,
    );
  });

  it("does not make the new state terminal", () => {
    expect(isTerminal("awaiting_customer")).toBe(false);
  });
});
