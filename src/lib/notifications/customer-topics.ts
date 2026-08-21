/**
 * What a customer can be told, and down which channel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS REPLACED FOUR BOOLEANS.
 *
 *  A customer had one switch per topic, and that switch meant "in-app AND
 *  email", with push governed separately by a single account-wide flag. So
 *  the only way to stop an email about an order was to stop hearing about the
 *  order — and there was no way at all to keep the email while dropping the
 *  push, or the reverse.
 *
 *  Managers have had the per-event, per-channel grid since migration 0012
 *  (lib/data/settings). This is the same idea for the other side of the app:
 *  every topic answers three separate questions.
 *
 *  NO LABELS IN THIS FILE. Only keys — for the same reason settings.ts carries
 *  none. `cst.evt.<key>` and `cst.evtBody.<key>` in the dictionary carry the
 *  words in both languages, and a topic added without both translations fails
 *  the build.
 *
 *  NOT `server-only`: the settings screen is a Client Component and needs the
 *  catalogue to render the grid. Nothing here touches the database — reading
 *  and writing live in lib/data/customer and customer-actions.
 *
 *  A MISSING ANSWER MEANS THE DEFAULT, NOT "OFF". Nobody is silenced by never
 *  having opened this screen, and a topic added next month does not arrive
 *  pre-silenced for everyone who saved their preferences today.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const CUSTOMER_TOPIC_KEYS = [
  "order_status",
  "reservations",
  "messages",
  "reviews",
  "loyalty",
  "promotions",
] as const;

export type CustomerTopicKey = (typeof CUSTOMER_TOPIC_KEYS)[number];

export const NOTIFICATION_CHANNEL_KEYS = ["inApp", "email", "push"] as const;

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNEL_KEYS)[number];

export type TopicChannels = Record<NotificationChannelKey, boolean>;

export interface CustomerTopic {
  key: CustomerTopicKey;
  /** What someone who has never touched this screen receives. */
  defaults: TopicChannels;
  /**
   * Channels that cannot be switched off for this topic, pinned on read AND
   * on write — the disabled switch is a courtesy, the server action is the
   * rule.
   *
   * Only ever `inApp`, and only for the order. The record of what happened to
   * something you paid for is not a newsletter, and a customer who cannot see
   * it in the app has no other copy. Email and push stay free even there,
   * which is the whole point: "stop emailing me about every order" was not
   * previously expressible without also going blind to the orders.
   */
  locked: NotificationChannelKey[];
}

export const CUSTOMER_TOPICS: readonly CustomerTopic[] = [
  {
    key: "order_status",
    defaults: { inApp: true, email: true, push: true },
    locked: ["inApp"],
  },
  {
    key: "reservations",
    defaults: { inApp: true, email: true, push: true },
    locked: [],
  },
  {
    key: "messages",
    // No email by default: a chat reply that mails you is how a conversation
    // becomes an inbox full of one-line notifications.
    defaults: { inApp: true, email: false, push: true },
    locked: [],
  },
  {
    key: "reviews",
    defaults: { inApp: true, email: false, push: true },
    locked: [],
  },
  {
    key: "loyalty",
    defaults: { inApp: true, email: false, push: true },
    locked: [],
  },
  {
    key: "promotions",
    /*
      Marketing is OPT-IN on the channels that reach outside the app, and this
      default settles a disagreement the code has been carrying.

      lib/data/customer said promotions default to off; lib/notify said they
      default to on. So the settings screen showed the switch off while
      broadcasts were being delivered anyway — the UI was lying to every
      customer who had never saved a preference. Splitting by channel resolves
      it honestly in both directions: an admin broadcast still lands in the
      app, where a broadcast belongs, and nothing is emailed or pushed to a
      person who never asked for it.
    */
    defaults: { inApp: true, email: false, push: false },
    locked: [],
  },
];

export const CUSTOMER_TOPIC_BY_KEY: Record<CustomerTopicKey, CustomerTopic> = Object.fromEntries(
  CUSTOMER_TOPICS.map((topic) => [topic.key, topic]),
) as Record<CustomerTopicKey, CustomerTopic>;

/** One customer's full answer: every topic, every channel. */
export type CustomerTopicPreferences = Record<CustomerTopicKey, TopicChannels>;

export function customerTopicDefaults(): CustomerTopicPreferences {
  return Object.fromEntries(
    CUSTOMER_TOPICS.map((topic) => [topic.key, { ...topic.defaults }]),
  ) as CustomerTopicPreferences;
}

/**
 * Apply a topic's locked channels over whatever was supplied.
 *
 * Used on read and on write, so a row stored before a channel was locked — or
 * written by a client that lied — cannot silence it.
 */
export function applyLocks(key: CustomerTopicKey, channels: TopicChannels): TopicChannels {
  const topic = CUSTOMER_TOPIC_BY_KEY[key];
  if (!topic) return channels;

  const out = { ...channels };
  for (const channel of topic.locked) out[channel] = topic.defaults[channel];
  return out;
}

/**
 * Read one topic's answer out of whatever `notification_json` holds.
 *
 * THE LEGACY SHAPE IS A BARE BOOLEAN. Before this file, the column stored
 * `{ "order_status": true, … }`, where the boolean gated in-app and email
 * together and push came from the separate `push_enabled` column. Reading it
 * back as `{ inApp: v, email: v, push: v && pushEnabled }` reproduces exactly
 * what that customer was receiving — so nobody's settings change underneath
 * them on the deploy that introduces the grid.
 */
export function readTopic(
  key: CustomerTopicKey,
  stored: unknown,
  legacyPushEnabled: boolean,
): TopicChannels {
  const topic = CUSTOMER_TOPIC_BY_KEY[key];
  const defaults = topic?.defaults ?? { inApp: true, email: true, push: true };

  if (typeof stored === "boolean") {
    return applyLocks(key, {
      inApp: stored,
      email: stored,
      push: stored && legacyPushEnabled,
    });
  }

  if (typeof stored === "object" && stored !== null) {
    const row = stored as Record<string, unknown>;
    const pick = (snake: string, camel: NotificationChannelKey) => {
      const value = row[snake] ?? row[camel];
      return typeof value === "boolean" ? value : defaults[camel];
    };
    return applyLocks(key, {
      inApp: pick("in_app", "inApp"),
      email: pick("email", "email"),
      push: pick("push", "push"),
    });
  }

  return { ...defaults };
}

/** Every topic, read out of one stored `notification_json` value. */
export function readTopicPreferences(
  stored: unknown,
  legacyPushEnabled: boolean,
): CustomerTopicPreferences {
  const obj =
    typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};

  return Object.fromEntries(
    CUSTOMER_TOPICS.map((topic) => [
      topic.key,
      readTopic(topic.key, obj[topic.key], legacyPushEnabled),
    ]),
  ) as CustomerTopicPreferences;
}

/** The stored shape, locks applied — what the save action writes. */
export function toStoredJson(prefs: CustomerTopicPreferences): Record<string, TopicChannels> {
  const out: Record<string, TopicChannels> = {};
  for (const topic of CUSTOMER_TOPICS) {
    const channels = applyLocks(topic.key, prefs[topic.key] ?? topic.defaults);
    out[topic.key] = {
      inApp: Boolean(channels.inApp),
      email: Boolean(channels.email),
      push: Boolean(channels.push),
    };
  }
  return out;
}

/**
 * The legacy `push_enabled` column, kept in step.
 *
 * It is not read by anything after this change, but it is `not null` in the
 * schema and an older build pointed at the same database still consults it.
 * "Any topic wants push" is the closest true statement a single flag can make.
 */
export function anyPushWanted(prefs: CustomerTopicPreferences): boolean {
  return CUSTOMER_TOPICS.some((topic) => prefs[topic.key]?.push);
}
