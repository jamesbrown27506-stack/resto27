import { describe, expect, it } from "vitest";
import { socialUrlIsValid } from "./social-platforms";

describe("socialUrlIsValid", () => {
  it("accepts official HTTPS profile domains", () => {
    expect(socialUrlIsValid("facebook", "https://www.facebook.com/resto237")).toBe(true);
    expect(socialUrlIsValid("whatsapp", "https://wa.me/237600000000")).toBe(true);
    expect(socialUrlIsValid("x", "https://twitter.com/resto237")).toBe(true);
  });

  it("rejects insecure, deceptive, and malformed links", () => {
    expect(socialUrlIsValid("instagram", "http://instagram.com/resto237")).toBe(false);
    expect(socialUrlIsValid("facebook", "https://facebook.com.example.com/resto237")).toBe(false);
    expect(socialUrlIsValid("youtube", "not-a-url")).toBe(false);
  });
});
