import { DISPLAY_TZ } from "@/lib/format/datetime";
import { weekdayOfDate } from "@/lib/reservations/slots";

export type ServiceHours = { weekday: number; opensAt: string | null; closesAt: string | null };
export const ORDER_PREP_LEAD_MIN = 30;

function localParts(instant: Date): { date: string; minute: number; weekday: number } | null {
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const value = (part: string) => parts.find((entry) => entry.type === part)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const weekday = weekdayOfDate(date);
  if (weekday === null) return null;
  return { date, minute: Number(value("hour")) * 60 + Number(value("minute")), weekday };
}

function minuteOf(value: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value ?? "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null;
}

/** Includes the after-midnight part of a service window opened the previous day. */
export function isServiceOpenAt(hours: ServiceHours[], instant: Date): boolean {
  const local = localParts(instant);
  if (!local) return false;
  const today = hours.find((row) => row.weekday === local.weekday);
  const open = minuteOf(today?.opensAt ?? null);
  const close = minuteOf(today?.closesAt ?? null);
  if (open !== null && close !== null) {
    if (close > open && local.minute >= open && local.minute < close) return true;
    if (close <= open && local.minute >= open) return true;
  }
  const previous = hours.find((row) => row.weekday === (local.weekday + 6) % 7);
  const previousOpen = minuteOf(previous?.opensAt ?? null);
  const previousClose = minuteOf(previous?.closesAt ?? null);
  return previousOpen !== null && previousClose !== null && previousClose <= previousOpen && local.minute < previousClose;
}

/** A pickup/delivery time needs a full preparation window inside service hours. */
export function canFulfilAt(hours: ServiceHours[], instant: Date): boolean {
  return isServiceOpenAt(hours, instant) &&
    isServiceOpenAt(hours, new Date(instant.getTime() - ORDER_PREP_LEAD_MIN * 60_000));
}

export function canTakeAsapOrder(hours: ServiceHours[], now: Date = new Date()): boolean {
  return isServiceOpenAt(hours, now) &&
    isServiceOpenAt(hours, new Date(now.getTime() + ORDER_PREP_LEAD_MIN * 60_000));
}

/** First 15-minute pickup/delivery slot inside the next seven days. */
export function nextServiceSlot(hours: ServiceHours[], now: Date = new Date()): Date | null {
  const step = 15 * 60_000;
  const earliest = Math.ceil((now.getTime() + ORDER_PREP_LEAD_MIN * 60_000) / step) * step;
  for (let time = earliest; time <= now.getTime() + 7 * 86_400_000; time += step) {
    const candidate = new Date(time);
    if (canFulfilAt(hours, candidate)) return candidate;
  }
  return null;
}

export function serviceDateAndTime(instant: Date): { date: string; time: string } | null {
  const local = localParts(instant);
  if (!local) return null;
  const hour = String(Math.floor(local.minute / 60)).padStart(2, "0");
  const minute = String(local.minute % 60).padStart(2, "0");
  return { date: local.date, time: `${hour}:${minute}` };
}
