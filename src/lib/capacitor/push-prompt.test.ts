import { describe, expect, it } from "vitest";
import { NATIVE_PROMPT_COOLDOWN_MS, nativePushOffer } from "./push-prompt";

const base = {
  signedIn: true,
  wantsPush: true,
  enabled: false,
  permission: "prompt",
  optedOut: false,
  dismissedAt: null,
  now: 1_000_000_000,
};

describe("nativePushOffer", () => {
  it("asks a signed-in user whose phone is not registered yet", () => {
    expect(nativePushOffer(base)).toBe("ask");
  });

  it("asks when Android already allows notifications but the phone never registered", () => {
    expect(nativePushOffer({ ...base, permission: "granted" })).toBe("ask");
  });

  it("stays quiet once the phone is registered", () => {
    expect(nativePushOffer({ ...base, enabled: true, permission: "granted" })).toBeNull();
  });

  it("never asks a guest, someone who turned push off, or a device switched off", () => {
    expect(nativePushOffer({ ...base, signedIn: false })).toBeNull();
    expect(nativePushOffer({ ...base, wantsPush: false })).toBeNull();
    expect(nativePushOffer({ ...base, optedOut: true })).toBeNull();
  });

  it("waits an hour after Not now, then asks again", () => {
    expect(nativePushOffer({ ...base, dismissedAt: base.now - 1_000 })).toBeNull();
    expect(nativePushOffer({ ...base, dismissedAt: base.now - NATIVE_PROMPT_COOLDOWN_MS - 1 })).toBe("ask");
  });

  it("explains the phone setting when Android has blocked the app", () => {
    expect(nativePushOffer({ ...base, permission: "denied" })).toBe("blocked");
    expect(nativePushOffer({ ...base, enabled: true, permission: "denied" })).toBe("blocked");
  });
});
