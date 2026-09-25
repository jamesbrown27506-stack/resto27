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

  it("lets a reaction answer a good review but not a bad one", () => {
    expect(reviewNeedsAttention({ ...base, reaction: "heart" })).toBe(false);
    expect(reviewNeedsAttention({ ...base, rating: 2, reaction: "heart" })).toBe(true);
    expect(reviewNeedsAttention({ ...base, rating: 2, seenAt: "2026-09-25T10:00:00Z" })).toBe(false);
  });

  it("accepts only known reactions", () => {
    expect(isReviewReaction("heart")).toBe(true);
    expect(isReviewReaction("angry")).toBe(false);
  });
});
