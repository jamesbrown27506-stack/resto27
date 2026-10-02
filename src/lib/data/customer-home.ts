import "server-only";
import { fetchCustomerOrders, fetchCustomerReservations, type CustomerOrder, type CustomerReservation } from "./customer";
import { fetchActiveRestaurants, type PublicRestaurant } from "./public";
import { fetchDiscoveryCatalog, fetchHomeDishGroups, fetchMenuPicks, type MenuPick } from "./discovery";
import { getLoyaltyState } from "./cart-actions";
import { getTimeLimits } from "@/lib/orders/time-limit-settings";
import { partitionCustomerReservations } from "@/lib/reservations/lifecycle";
import { bookingDay, homeBookings, splitHomeOrders, type BookingDay, type TimedOrder } from "@/lib/customer-home/sections";
import { isOpenNow } from "@/lib/format/hours";
import { doualaClock } from "@/lib/seo-guides";
import type { DishGroup } from "@/lib/menu-summary";

/**
 * Everything the signed-in customer's home shows, in one read.
 *
 * Every part degrades on its own: the loaders it calls never throw (they log
 * and return empty), so a slow menu read costs the home one section, never
 * the screen that tells someone their order is waiting for payment.
 */

export interface HomeBooking {
  booking: CustomerReservation;
  day: BookingDay;
}

export interface FeaturedRestaurant {
  restaurant: PublicRestaurant;
  openNow: boolean;
}

export interface CustomerHomeData {
  orderMinutes: number;
  toPay: TimedOrder<CustomerOrder>[];
  waiting: TimedOrder<CustomerOrder>[];
  inProgress: CustomerOrder[];
  bookings: HomeBooking[];
  reorder: CustomerOrder[];
  /** A photo per reorder card: the first of its dishes still on the menu with one. */
  reorderImages: Record<string, string | null>;
  /** Loyalty balance, null when the programme is off. */
  points: number | null;
  cravings: DishGroup[];
  menu: MenuPick[];
  featured: FeaturedRestaurant[];
}

export async function fetchCustomerHome(profileId: string): Promise<CustomerHomeData> {
  const [orders, reservations, limits, loyalty, cravings, menu, restaurants, catalog] = await Promise.all([
    fetchCustomerOrders(profileId, 30),
    fetchCustomerReservations(profileId),
    getTimeLimits(),
    getLoyaltyState().catch(() => null),
    fetchHomeDishGroups(8),
    fetchMenuPicks(6),
    fetchActiveRestaurants(),
    fetchDiscoveryCatalog().catch(() => null),
  ]);

  const now = Date.now();
  const split = splitHomeOrders(orders, limits.orderMinutes, now);
  const { upcoming } = partitionCustomerReservations(reservations, now);
  const clock = doualaClock(new Date(now));
  const imageById = new Map((catalog?.dishes ?? []).map((dish) => [dish.id, dish.image_url]));

  return {
    orderMinutes: limits.orderMinutes,
    ...split,
    reorderImages: Object.fromEntries(
      split.reorder.map((order) => [
        order.id,
        order.items.map((item) => (item.menuItemId ? imageById.get(item.menuItemId) : null)).find(Boolean) ?? null,
      ]),
    ),
    bookings: homeBookings(upcoming, now).map((booking) => ({ booking, day: bookingDay(booking.reservedFor, now) })),
    points: loyalty?.enabled ? loyalty.balance : null,
    cravings,
    menu,
    featured: [...restaurants]
      .sort((a, b) => (a.placement ?? Number.MAX_SAFE_INTEGER) - (b.placement ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 6)
      .map((restaurant) => ({ restaurant, openNow: isOpenNow(restaurant.hours, clock) })),
  };
}
