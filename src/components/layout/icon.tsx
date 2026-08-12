import {
  Apple,
  Armchair,
  Banana,
  Bean,
  Beef,
  Beer,
  Bell,
  Cake,
  CakeSlice,
  CalendarCheck,
  CalendarClock,
  Candy,
  Carrot,
  ChartColumn,
  ChefHat,
  Cherry,
  Citrus,
  Coffee,
  ConciergeBell,
  Cookie,
  CreditCard,
  Croissant,
  CupSoda,
  Dessert,
  Donut,
  Download,
  Drumstick,
  Egg,
  EggFried,
  Fish,
  Flag,
  Flame,
  Gift,
  GlassWater,
  Grape,
  Ham,
  Hamburger,
  HandPlatter,
  Heart,
  IceCreamBowl,
  IceCreamCone,
  // Aliased: bare `Image` collides with next/image in the mind of anyone
  // reading this file, even though nothing here imports it.
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  LifeBuoy,
  Lollipop,
  MapPin,
  Martini,
  Megaphone,
  Milk,
  Nut,
  PartyPopper,
  Percent,
  Pizza,
  Popcorn,
  ReceiptText,
  Salad,
  Sandwich,
  ScrollText,
  Settings,
  Shell,
  ShieldCheck,
  ShoppingBasket,
  Smartphone,
  Snowflake,
  Soup,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Sun,
  TicketPercent,
  Undo2,
  User,
  UserCog,
  Users,
  Utensils,
  UtensilsCrossed,
  Vegan,
  VenetianMask,
  Wheat,
  Wine,
  type LucideIcon,
} from "lucide-react";

/**
 * Explicit registry rather than `import * as Icons from "lucide-react"`.
 *
 * The namespace import pulls the entire icon set into the bundle because a
 * dynamic property lookup cannot be tree-shaken. Naming each icon keeps the
 * cost to what is actually used — which matters on the mobile connections
 * most of this audience is on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A NAME OFFERED IN A PICKER MUST EXIST HERE.
 *
 *  `NavIcon` renders nothing for an unknown name, so an icon offered in the
 *  category picker but missing from this object is not a fallback — it is a
 *  blank square the manager cannot tell apart from the next blank square.
 *  That is exactly what happened: the picker offered Coffee, Pizza, Soup,
 *  Salad, IceCream and Beer, and none of the six were registered.
 *
 *  CATEGORY_ICON_GROUPS below is now the single source of what the picker
 *  offers, and every entry in it is typed as `IconName` — so the compiler,
 *  not the reviewer, is what keeps the two in step.
 * ─────────────────────────────────────────────────────────────────────────
 */
const REGISTRY = {
  // ── Chrome / navigation ──
  Armchair,
  Bell,
  CalendarCheck,
  CalendarClock,
  ChartColumn,
  ConciergeBell,
  CreditCard,
  Download,
  Flag,
  Heart,
  Image: ImageIcon,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  MapPin,
  Megaphone,
  Percent,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Star,
  Stethoscope,
  Store,
  TicketPercent,
  Undo2,
  User,
  UserCog,
  Users,
  VenetianMask,

  // ── Menu categories: savoury ──
  Beef,
  ChefHat,
  Drumstick,
  Egg,
  EggFried,
  Fish,
  Ham,
  Hamburger,
  HandPlatter,
  Pizza,
  Salad,
  Sandwich,
  Shell,
  Soup,
  Utensils,
  UtensilsCrossed,

  // ── Menu categories: produce & staples ──
  Apple,
  Banana,
  Bean,
  Carrot,
  Cherry,
  Citrus,
  Grape,
  Leaf,
  Nut,
  Vegan,
  Wheat,

  // ── Menu categories: drinks ──
  Beer,
  Coffee,
  CupSoda,
  GlassWater,
  Martini,
  Milk,
  Wine,

  // ── Menu categories: sweet ──
  Cake,
  CakeSlice,
  Candy,
  Cookie,
  Croissant,
  Dessert,
  Donut,
  IceCreamBowl,
  IceCreamCone,
  Lollipop,
  Popcorn,

  // ── Menu categories: occasions & markers ──
  Flame,
  Gift,
  PartyPopper,
  ShoppingBasket,
  Snowflake,
  Sparkles,
  Sun,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof REGISTRY;

/** The default a category falls back to — and what `createCategory` stores. */
export const DEFAULT_CATEGORY_ICON: IconName = "UtensilsCrossed";

/**
 * What the category picker offers, grouped so a 60-icon grid stays scannable.
 *
 * Labels are NOT here: they are translated at the point of use via
 * `icons.group.<key>`, because this module is imported by Server Components
 * that cannot call `useLocale()`.
 */
export const CATEGORY_ICON_GROUPS: { key: string; icons: IconName[] }[] = [
  {
    key: "savoury",
    icons: [
      "UtensilsCrossed",
      "Utensils",
      "ChefHat",
      "HandPlatter",
      "Soup",
      "Salad",
      "Beef",
      "Drumstick",
      "Fish",
      "Shell",
      "Ham",
      "Egg",
      "EggFried",
      "Pizza",
      "Hamburger",
      "Sandwich",
    ],
  },
  {
    key: "produce",
    icons: ["Leaf", "Vegan", "Carrot", "Bean", "Wheat", "Nut", "Apple", "Banana", "Cherry", "Citrus", "Grape"],
  },
  {
    key: "drinks",
    icons: ["Coffee", "CupSoda", "GlassWater", "Milk", "Beer", "Wine", "Martini"],
  },
  {
    key: "sweet",
    icons: [
      "Dessert",
      "Cake",
      "CakeSlice",
      "IceCreamCone",
      "IceCreamBowl",
      "Cookie",
      "Croissant",
      "Donut",
      "Candy",
      "Lollipop",
      "Popcorn",
    ],
  },
  {
    key: "markers",
    icons: ["Flame", "Star", "Sparkles", "Gift", "PartyPopper", "Snowflake", "Sun", "ShoppingBasket", "LayoutGrid"],
  },
];

/** True when `name` is something this registry can actually draw. */
export function isIconName(name: string): name is IconName {
  return Object.hasOwn(REGISTRY, name);
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  // Falls back rather than rendering nothing. A category saved with an icon
  // that was later retired should still show *something* round and food-shaped
  // instead of collapsing its own layout.
  const Component = REGISTRY[name as IconName] ?? REGISTRY[DEFAULT_CATEGORY_ICON];
  return <Component className={className} aria-hidden />;
}
