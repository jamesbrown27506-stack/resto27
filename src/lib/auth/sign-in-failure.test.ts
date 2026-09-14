import { describe, expect, it } from "vitest";
import { signInFailureReason } from "./sign-in-failure";

describe("signInFailureReason", () => {
  it("a wrong password or unknown email is 'invalid'", () => {
    expect(signInFailureReason({ status: 400, code: "invalid_credentials" })).toBe("invalid");
    expect(signInFailureReason({ status: 400 })).toBe("invalid");
    expect(signInFailureReason(null)).toBe("invalid");
  });

  it("an unconfirmed email says so instead of blaming the password", () => {
    expect(signInFailureReason({ status: 400, code: "email_not_confirmed" })).toBe("unconfirmed");
  });

  it("Supabase's rate limit is 'busy'", () => {
    expect(signInFailureReason({ status: 429, code: "over_request_rate_limit" })).toBe("busy");
    expect(signInFailureReason({ status: 429 })).toBe("busy");
  });

  it("a timeout or outage is 'unavailable' — the 504s of 14 Sep 2026", () => {
    expect(signInFailureReason({ status: 504 })).toBe("unavailable");
    expect(signInFailureReason({ status: 500, code: "unexpected_failure" })).toBe("unavailable");
    expect(signInFailureReason({ status: 0, name: "AuthRetryableFetchError" })).toBe("unavailable");
  });
});
