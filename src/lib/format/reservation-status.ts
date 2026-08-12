/**
 * Reservation status, as the customer UI sees it.
 *
 * Kept in `format/` (not `lib/data/`) because it is imported by client
 * components — `lib/data/*` pulls in the service-role Supabase client, which
 * depends on `next/headers` and cannot travel to the browser.
 */

export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type CustomerReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABEL: Record<CustomerReservationStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  seated: "Attablée",
  completed: "Honorée",
  cancelled: "Annulée",
  no_show: "Absent",
};

export const RESERVATION_STATUS_TONE: Record<
  CustomerReservationStatus,
  "neutral" | "success" | "warning" | "error" | "info"
> = {
  pending: "warning",
  confirmed: "info",
  seated: "info",
  completed: "success",
  cancelled: "neutral",
  no_show: "error",
};
