/**
 * "Add to my calendar" — one booking as an iCalendar event.
 *
 * Built in the browser from data the customer already sees, so no route and
 * no server call: the file is a Blob the phone hands to its calendar app.
 * Times are written in UTC (the trailing Z), which every calendar converts to
 * the phone's own zone — no VTIMEZONE block to get wrong.
 */

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 text escaping: backslash, semicolon, comma, newline. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function reservationIcs(input: {
  uid: string;
  title: string;
  start: Date;
  durationMin: number;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  now?: Date;
}): string {
  const end = new Date(input.start.getTime() + Math.max(15, input.durationMin) * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Resto237//Reservations//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}@resto237.online`,
    `DTSTAMP:${stamp(input.now ?? new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(input.title)}`,
    input.location ? `LOCATION:${escapeText(input.location)}` : "",
    input.description ? `DESCRIPTION:${escapeText(input.description)}` : "",
    input.url ? `URL:${input.url}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(input.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n") + "\r\n";
}

/** A maps search for the restaurant — a place, never a phone number. */
export function mapsUrl(parts: (string | null | undefined)[]): string | null {
  const query = parts.map((p) => p?.trim()).filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}
