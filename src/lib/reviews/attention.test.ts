import { describe, expect, it } from "vitest";
import { isReviewReaction, reviewNeedsAttention } from "./attention";

const base = { rating: 5, reply: null, isReported: false, seenAt: null, reaction: null } as const;

describe("reviews needing the restaurant", () => {
  it("counts a new unanswered review", () => {
    expect(reviewNeedsAttention(base)).toBe(true);
  });

  it("clears on reply, on 'read', and when reported", () => {
    expect(reviewNeedsAttention({ ...base, reply: "Merci !" })).toBe(false);
    expect(reviewNeedsAttention({ ...base, seenAt: "2026-09-25T10:00:00Z" })).toBe(false);
    expect(reviewNeedsAttention({ ...base, isReported: true })).toBe(false);
  });

  it("treats any reaction as handled, whatever the rating", () => {
    expect(reviewNeedsAttention({ ...base, reaction: "heart" })).toBe(false);
    expect(reviewNeedsAttention({ ...base, rating: 2, reaction: "like" })).toBe(false);
    expect(reviewNeedsAttention({ ...base, rating: 1 })).toBe(true);
  });

  it("accepts only known reactions", () => {
    expect(isReviewReaction("heart")).toBe(true);
    expect(isReviewReaction("angry")).toBe(false);
  });
});
