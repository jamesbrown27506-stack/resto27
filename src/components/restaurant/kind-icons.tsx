import {
  CakeSlice,
  Croissant,
  CupSoda,
  Fish,
  Flame,
  IceCreamCone,
  Sandwich,
  Soup,
  Store,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type { DishCourse } from "@/lib/menu/course";
import { normalizeText } from "@/lib/search/fuzzy";

/** One picture per kind of dish (lib/menu/course) — Explore's chips, the home, the menu editor. */
export const COURSE_ICONS: Record<DishCourse, LucideIcon> = {
  light: Croissant,
  main: UtensilsCrossed,
  dessert: IceCreamCone,
  drink: CupSoda,
};

/**
 * A picture for a restaurant type (the `cuisines` table). The types are
 * admin-editable rows, so this matches words rather than exact names, and
 * anything it does not recognise gets the shop front.
 */
export function cuisineIcon(name: string): LucideIcon {
  const n = normalizeText(name);
  if (/glace|dessert|douceur/.test(n)) return IceCreamCone;
  if (/boisson|bar|drink/.test(n)) return CupSoda;
  if (/petit dej|breakfast|snack/.test(n)) return Croissant;
  if (/patisserie|boulangerie|gateau/.test(n)) return CakeSlice;
  if (/fast|burger|pizza/.test(n)) return Sandwich;
  if (/grill|braise|brais/.test(n)) return Flame;
  if (/poisson|fish|mer/.test(n)) return Fish;
  if (/camerou|africa|tradition/.test(n)) return Soup;
  if (/continental|europe|internation/.test(n)) return UtensilsCrossed;
  return Store;
}
