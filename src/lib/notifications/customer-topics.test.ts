import { describe, expect, it } from "vitest";
import {
  anyPushWanted,
  applyLocks,
  customerTopicDefaults,
  readTopic,
  readTopicPreferences,
  toStoredJson,
  CUSTOMER_TOPIC_KEYS,
} from "./customer-topics";

/**
 * The stakes here are that nobody's settings change underneath them.
 *
 * The column has been storing bare booleans since migration 0014. This deploy
 * starts writing per-channel objects into the same column, so every read has to
 * handle both — and the legacy read has to reproduce exactly what that customer
 * was already receiving, not what the new defaults would give them.
 */

describe("readTopic — legacy boolean rows", () => {
  it("reads `true` as in-app and email on, push following the old column", () => {
    expect(readTopic("reservations", true, true)).toEqual({
      inApp: true,
      email: true,
      push: true,
    });
    // The old shape gated push on a separate account-wide column, so a
    // customer with push off must not be handed push on by the migration.
    expect(readTopic("reservations", true, false)).toEqual({
      inApp: true,
      email: true,
      push: false,
    });
  });

  it("reads `false` as everything off for that topic", () => {
    expect(readTopic("promotions", false, true)).toEqual({
      inApp: false,
      email: false,
      push: false,
    });
  });

  it("still cannot silence a locked channel", () => {
    // order_status.inApp is locked: a legacy `false` turned off in-app AND
    // email together, and only the email half survives the migration.
    expect(readTopic("order_status", false, true)).toEqual({
      inApp: true,
      email: false,
      push: false,
    });
  });
});

describe("readTopic — the new per-channel shape", () => {
  it("reads snake_case as stored", () => {
    expect(readTopic("loyalty", { in_app: true, email: false, push: true }, true)).toEqual({
      inApp: true,
      email: false,
      push: true,
    });
  });

  it("accepts camelCase too", () => {
    expect(readTopic("loyalty", { inApp: false, email: true, push: false }, true)).toEqual({
      inApp: false,
      email: true,
      push: false,
    });
  });

  it("falls back to the topic default for a channel that is missing", () => {
    // A topic stored before `push` existed as a separate answer.
    expect(readTopic("loyalty", { in_app: false }, true)).toEqual({
      inApp: false,
      email: false, // loyalty's default
      push: true, //  loyalty's default
    });
  });

  it("pins a locked channel over whatever was stored", () => {
    expect(readTopic("order_status", { in_app: false, email: false, push: false }, true)).toEqual({
      inApp: true,
      email: false,
      push: false,
    });
  });
});

describe("readTopicPreferences", () => {
  it("gives every known topic an answer, stored or default", () => {
    const prefs = readTopicPreferences({ loyalty: false }, true);
    expect(Object.keys(prefs).sort()).toEqual([...CUSTOMER_TOPIC_KEYS].sort());
    expect(prefs.loyalty).toEqual({ inApp: false, email: false, push: false });
    // A topic the stored row has never heard of is the default, not off —
    // nobody is opted out of something added after they last saved.
    expect(prefs.messages).toEqual({ inApp: true, email: false, push: true });
  });

  it("returns defaults for a null or nonsense column", () => {
    expect(readTopicPreferences(null, true)).toEqual(customerTopicDefaults());
    expect(readTopicPreferences("not json", true)).toEqual(customerTopicDefaults());
  });
});

describe("defaults", () => {
  it("keeps marketing out of the inbox and off the lock screen", () => {
    const defaults = customerTopicDefaults();
    expect(defaults.promotions.email).toBe(false);
    expect(defaults.promotions.push).toBe(false);
    // …but an admin broadcast still lands in the app, which is what the
    // broadcast feature is for.
    expect(defaults.promotions.inApp).toBe(true);
  });

  it("tells you about your own orders by every route", () => {
    expect(customerTopicDefaults().order_status).toEqual({
      inApp: true,
      email: true,
      push: true,
    });
  });
});

describe("toStoredJson", () => {
  it("re-applies locks, so a lying client cannot silence the order", () => {
    const prefs = customerTopicDefaults();
    prefs.order_status = { inApp: false, email: false, push: false };

    const stored = toStoredJson(prefs);
    expect(stored.order_status.inApp).toBe(true);
    // The channels that are NOT locked keep what was asked for — this is the
    // whole point: "stop emailing me about orders" must be expressible.
    expect(stored.order_status.email).toBe(false);
    expect(stored.order_status.push).toBe(false);
  });

  it("writes every topic, so the row describes the whole screen", () => {
    expect(Object.keys(toStoredJson(customerTopicDefaults())).sort()).toEqual(
      [...CUSTOMER_TOPIC_KEYS].sort(),
    );
  });

  it("round-trips through readTopicPreferences unchanged", () => {
    const prefs = customerTopicDefaults();
    prefs.reservations = { inApp: true, email: false, push: true };
    prefs.promotions = { inApp: false, email: true, push: false };

    expect(readTopicPreferences(toStoredJson(prefs), true)).toEqual(prefs);
  });
});

describe("applyLocks", () => {
  it("leaves an unlocked topic alone", () => {
    const channels = { inApp: false, email: false, push: false };
    expect(applyLocks("promotions", channels)).toEqual(channels);
  });
});

describe("anyPushWanted", () => {
  it("is true when at least one topic wants push", () => {
    expect(anyPushWanted(customerTopicDefaults())).toBe(true);
  });

  it("is false only when every topic has push off", () => {
    const prefs = customerTopicDefaults();
    for (const key of CUSTOMER_TOPIC_KEYS) prefs[key] = { inApp: true, email: true, push: false };
    expect(anyPushWanted(prefs)).toBe(false);
  });
});
