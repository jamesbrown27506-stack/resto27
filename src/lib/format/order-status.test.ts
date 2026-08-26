import { describe, expect, it } from "vitest";
import {
  ORDER_FLOW,
  ORDER_STATUSES,
  ORDER_TYPES,
  advanceLabelKey,
  canCustomerCancel,
  hasRestaurantActions,
  isTerminal,
  nextStatus,
  orderFlow,
  orderStatusMeta,
  flowIndex,
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

describe("advanceLabelKey", () => {
  it("offers no button at awaiting_customer", () => {
    // A button here would be the restaurant agreeing to a price on the
    // customer's behalf.
    expect(advanceLabelKey("awaiting_customer", "delivery")).toBeNull();
  });

  it("labels every step the restaurant owns, for delivery", () => {
    expect(advanceLabelKey("pending", "delivery")).toBe("ost.next.confirmed");
    expect(advanceLabelKey("confirmed", "delivery")).toBe("ost.next.preparing");
    expect(advanceLabelKey("preparing", "delivery")).toBe("ost.next.delivery.shipped");
    expect(advanceLabelKey("shipped", "delivery")).toBe("ost.next.delivery.delivered");
    expect(advanceLabelKey("delivered", "delivery")).toBeNull();
  });

  it("says something different for the SAME transition on a pickup", () => {
    // The heart of the change: one state machine, three vocabularies. Leaving
    // preparing -> shipped as "Envoyer" told a takeaway customer their food
    // had gone out for delivery.
    expect(advanceLabelKey("preparing", "pickup")).toBe("ost.next.pickup.shipped");
    expect(advanceLabelKey("shipped", "pickup")).toBe("ost.next.pickup.delivered");
    expect(advanceLabelKey("preparing", "dine_in")).toBe("ost.next.dine_in.shipped");
    expect(advanceLabelKey("shipped", "dine_in")).toBe("ost.next.dine_in.delivered");
  });

  it("shares the early steps, because they genuinely are the same", () => {
    for (const type of ORDER_TYPES) {
      expect(advanceLabelKey("pending", type)).toBe("ost.next.confirmed");
      expect(advanceLabelKey("confirmed", type)).toBe("ost.next.preparing");
    }
  });
});

describe("orderFlow", () => {
  it("keeps the fee step for delivery only", () => {
    expect(orderFlow("delivery")).toContain("awaiting_customer");
  });

  it("drops it for pickup and dine-in", () => {
    // A takeaway has no delivery fee to approve, so showing the step promised
    // a stage that could never arrive.
    expect(orderFlow("pickup")).not.toContain("awaiting_customer");
    expect(orderFlow("dine_in")).not.toContain("awaiting_customer");
  });
});

describe("flowIndex", () => {
  it("does not count a step the order will never reach", () => {
    // The off-by-one this fixes: with awaiting_customer in the array, a
    // confirmed PICKUP order scored 2 and the timeline painted the
    // delivery-fee step as already done.
    expect(flowIndex("confirmed", "pickup")).toBe(1);
    expect(flowIndex("confirmed", "delivery")).toBe(2);
  });

  it("is -1 for a cancelled order in every type", () => {
    for (const type of ORDER_TYPES) expect(flowIndex("cancelled", type)).toBe(-1);
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
  it("gives every status display metadata in every order type", () => {
    // A combination without an entry renders as a blank badge rather than
    // failing loudly, which is how one gets missed. 21 combinations.
    for (const type of ORDER_TYPES) {
      for (const status of ORDER_STATUSES) {
        const meta = orderStatusMeta(status, type);
        expect(meta, `${type}/${status}`).toBeDefined();
        expect(meta.labelKey.length, `${type}/${status}`).toBeGreaterThan(0);
        expect(meta.descKey.length, `${type}/${status}`).toBeGreaterThan(0);
        expect(meta.badge.length, `${type}/${status}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps colour keyed on the state, not the journey", () => {
    // preparing is warning-coloured whether the food is going on a bike or
    // onto a counter — only the words and the icon fork.
    const [a, b, c] = ORDER_TYPES.map((t) => orderStatusMeta("preparing", t).badge);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("gives pickup and dine-in their own icon at the handover step", () => {
    expect(orderStatusMeta("shipped", "delivery").icon).toBe("truck");
    expect(orderStatusMeta("shipped", "pickup").icon).toBe("shopping-bag");
    expect(orderStatusMeta("shipped", "dine_in").icon).toBe("hand-platter");
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
