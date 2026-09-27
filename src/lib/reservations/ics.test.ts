import { describe, expect, it } from "vitest";
import { mapsUrl, reservationIcs } from "./ics";

describe("calendar file", () => {
  it("writes a UTC event with an alarm two hours before", () => {
    const ics = reservationIcs({
      uid: "RES-AB12",
      title: "Table chez Mama, 4 pers.",
      start: new Date("2026-10-03T19:00:00Z"),
      durationMin: 90,
      location: "Bastos, Yaoundé",
      now: new Date("2026-09-27T10:00:00Z"),
    });
    expect(ics).toContain("DTSTART:20261003T190000Z");
    expect(ics).toContain("DTEND:20261003T203000Z");
    expect(ics).toContain("SUMMARY:Table chez Mama\\, 4 pers.");
    expect(ics).toContain("LOCATION:Bastos\\, Yaoundé");
    expect(ics).toContain("TRIGGER:-PT2H");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });

  it("builds a maps search from the address parts", () => {
    expect(mapsUrl(["Chez Mama", "Rue 1.234", null, "Yaoundé"])).toBe(
      "https://www.google.com/maps/search/?api=1&query=Chez%20Mama%2C%20Rue%201.234%2C%20Yaound%C3%A9",
    );
    expect(mapsUrl([null, " "])).toBeNull();
  });
});
