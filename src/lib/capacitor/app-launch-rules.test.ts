import { describe, expect, it } from "vitest";
import { isOutdated, launchLocaleHref, localeFromTag } from "./app-launch-rules";

describe("localeFromTag", () => {
  it("reads the phone's language", () => {
    expect(localeFromTag("en-GB")).toBe("en");
    expect(localeFromTag("EN")).toBe("en");
    expect(localeFromTag("fr-CM")).toBe("fr");
  });

  it("falls back to French for anything else or nothing", () => {
    expect(localeFromTag("de-DE")).toBe("fr");
    expect(localeFromTag("")).toBe("fr");
    expect(localeFromTag(undefined)).toBe("fr");
  });
});

describe("launchLocaleHref", () => {
  it("adds ?lang=en to a public page opened in English", () => {
    expect(launchLocaleHref("/", "en")).toBe("/?lang=en");
    expect(launchLocaleHref("/restaurants?q=ndole#menu", "en")).toBe("/restaurants?q=ndole&lang=en#menu");
  });

  it("removes it for French, and does nothing when the page already matches", () => {
    expect(launchLocaleHref("/?lang=en", "fr")).toBe("/");
    expect(launchLocaleHref("/", "fr")).toBeNull();
    expect(launchLocaleHref("/?lang=en", "en")).toBeNull();
  });

  it("leaves pages that take their language from the cookie alone", () => {
    expect(launchLocaleHref("/m/orders", "en")).toBeNull();
    expect(launchLocaleHref("/account", "en")).toBeNull();
  });
});

describe("isOutdated", () => {
  it("compares Android versionCodes", () => {
    expect(isOutdated("3", 4)).toBe(true);
    expect(isOutdated("4", 4)).toBe(false);
    expect(isOutdated("5", 4)).toBe(false);
  });

  it("never prompts when the installed version cannot be read", () => {
    expect(isOutdated("", 4)).toBe(false);
    expect(isOutdated(undefined, 4)).toBe(false);
    expect(isOutdated("web", 4)).toBe(false);
  });
});
