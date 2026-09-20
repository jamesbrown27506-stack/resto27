import { describe,expect,it } from "vitest";
import { canCloseDiningOrder,canGuestUseDiningSession,diningFeatureAllowed } from "./access";
describe("Enterprise table-service policy",()=>{
 it("allows active and grace Enterprise subscriptions only",()=>{
  expect(diningFeatureAllowed("enterprise","active")).toBe(true);
  expect(diningFeatureAllowed("enterprise","grace")).toBe(true);
  expect(diningFeatureAllowed("enterprise","locked")).toBe(false);
  expect(diningFeatureAllowed("professional","active")).toBe(false);
 });
 it("requires staff approval and an interactive visit",()=>{
  expect(canGuestUseDiningSession("approved","open")).toBe(true);
  expect(canGuestUseDiningSession("approved","payment_requested")).toBe(true);
  expect(canGuestUseDiningSession("pending","open")).toBe(false);
  expect(canGuestUseDiningSession("approved","closed")).toBe(false);
 });
 it("never closes an unpaid QR-table order",()=>{
  expect(canCloseDiningOrder(true,false)).toBe(false);
  expect(canCloseDiningOrder(true,true)).toBe(true);
  expect(canCloseDiningOrder(false,false)).toBe(true);
 });
});
