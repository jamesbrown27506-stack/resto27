"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { computeTotals, lineUnitPrice, type Totals } from "@/lib/orders/totals";
import { validatePromoCode } from "@/lib/data/cart-actions";
import type { PromoErrorReason } from "@/lib/orders/promotions";
import type { CartConfig } from "@/lib/orders/cart-config";

/**
 * The cart.
 *
 * GUESTS HAVE A CART (§2). It lives client-side and survives a reload through
 * localStorage — forcing registration before someone can see a total is the
 * single biggest drop-off point in food ordering.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  IT STARTS EMPTY, AND THE PROMOTION IS THE SERVER'S ANSWER.
 *
 *  It used to boot with two hardcoded lines from the menu fixture, so every
 *  visitor arrived holding somebody else's Poulet DG — and the promo code was
 *  matched against a PROMOTIONS array compiled into the bundle, which put
 *  every code and its percentage one devtools panel away.
 *
 *  Codes are now checked by `validatePromoCode`, which returns the DISCOUNT
 *  rather than the rule, and `placeOrder` re-derives all of it server-side
 *  anyway. Nothing the basket computes is trusted at checkout.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface CartOptionChoice {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

export interface CartLine {
  /** Stable key = menuItemId + optionsHash. */
  id: string;
  menuItemId: string;
  name: string;
  basePrice: number;
  quantity: number;
  options: CartOptionChoice[];
  notes: string | null;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  /** The dish's prep time in minutes — what a pickup customer waits for. */
  prepMinutes: number;
}

/**
 * Fingerprint of the chosen options (§3, `cart_items.options_hash`).
 *
 * This is what makes "Pizza, large, extra cheese" and "Pizza, small" two lines
 * in the basket rather than quantity 2 of one line. Option ids are sorted so
 * the same selection made in a different order produces the same hash.
 */
export function optionsHash(menuItemId: string, options: CartOptionChoice[]): string {
  const ids = options.map((o) => o.optionId).sort();
  return `${menuItemId}::${ids.join("|")}`;
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  /** Every line belongs to one restaurant — see `addLine`. */
  restaurantId: string | null;
  promoCode: string | null;
  promoLabel: string | null;
  /** A reason CODE for the page to translate, never a sentence. */
  promoError: PromoErrorReason | null;
  promoMinimum: number | null;
  promoPending: boolean;
  loyaltyPointsUsed: number;
  totals: Totals;
  config: CartConfig;
  /** False until localStorage has been read — see the hydration note below. */
  ready: boolean;
  addLine: (line: Omit<CartLine, "id">) => void;
  setQuantity: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  clear: () => void;
  applyPromo: (code: string) => void;
  removePromo: () => void;
  setLoyaltyPointsUsed: (points: number) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "restolink-cart";

/* ── The store: localStorage ────────────────────────────────────────────────
 *
 * localStorage IS the state, the way `<html lang>` is the state for the
 * locale. Two consequences, both wanted:
 *
 *   1. No `useState` + `useEffect` pair to keep in step, so there is no second
 *      copy of the basket to go stale — and no setState inside an effect,
 *      which the React Compiler rejects outright.
 *   2. Two open tabs agree. The `storage` event fires in the OTHER tab, so
 *      adding a dish in one updates the badge in the other instead of one tab
 *      silently overwriting the other's basket on its next write.
 */

const EMPTY: CartLine[] = [];

const listeners = new Set<() => void>();

/** Cached so getSnapshot returns a STABLE reference — a fresh array every call
 *  makes useSyncExternalStore re-render for ever. */
let cachedRaw: string | null = null;
let cachedLines: CartLine[] = EMPTY;

function parseLines(raw: string | null): CartLine[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;

    // Shape-checked rather than cast. localStorage is user-editable, and a
    // malformed line would otherwise reach `lineUnitPrice` and render NaN
    // across the whole basket.
    return parsed.filter((l): l is CartLine => {
      const line = l as Partial<CartLine>;
      return (
        typeof line?.id === "string" &&
        typeof line.menuItemId === "string" &&
        typeof line.name === "string" &&
        typeof line.basePrice === "number" &&
        Number.isFinite(line.basePrice) &&
        typeof line.quantity === "number" &&
        line.quantity > 0 &&
        Array.isArray(line.options) &&
        typeof line.restaurantId === "string" &&
        // prepMinutes was added after launch; a basket saved before it is
        // still valid, so a missing value is tolerated, not rejected.
        (typeof (line as { prepMinutes?: unknown }).prepMinutes === "number" ||
          (line as { prepMinutes?: unknown }).prepMinutes === undefined)
      );
    });
  } catch {
    return EMPTY;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): CartLine[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedLines;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLines = parseLines(raw);
  }
  return cachedLines;
}

/** The server has no basket. React uses this for SSR and for the hydration
 *  pass, then re-checks with getSnapshot — one ordinary re-render, never a
 *  hydration mismatch. */
function getServerSnapshot(): CartLine[] {
  return EMPTY;
}

function writeCart(next: CartLine[]): void {
  try {
    const raw = JSON.stringify(next);
    window.localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
  } catch {
    // Private mode, or the quota is full. Keep the basket in memory for this
    // page view rather than throwing inside a render tree.
    cachedRaw = null;
  }
  cachedLines = next;
  for (const listener of listeners) listener();
}

export function CartProvider({
  config,
  children,
}: {
  config: CartConfig;
  children: React.ReactNode;
}) {
  const lines = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /**
   * False on the server and during hydration, true once the browser has
   * answered. Pages use it to hold off "your basket is empty" for one frame,
   * which would otherwise flash on every load for someone who has a basket.
   */
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoLabel, setPromoLabel] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoError, setPromoError] = useState<PromoErrorReason | null>(null);
  const [promoMinimum, setPromoMinimum] = useState<number | null>(null);
  const [promoPending, startPromo] = useTransition();

  const [loyaltyPointsUsed, setLoyaltyPointsUsed] = useState(0);

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + lineUnitPrice(l.basePrice, l.options.map((o) => o.priceDelta)) * l.quantity,
        0,
      ),
    [lines],
  );

  const restaurantId = lines[0]?.restaurantId ?? null;

  const loyaltyValue = useMemo(() => {
    if (!config.loyaltyEnabled || loyaltyPointsUsed <= 0) return 0;
    const netFood = Math.max(0, subtotal - promoDiscount);
    return Math.min(loyaltyPointsUsed * config.pointValue, netFood);
  }, [config.loyaltyEnabled, config.pointValue, loyaltyPointsUsed, subtotal, promoDiscount]);

  const totals = useMemo(
    () =>
      computeTotals({
        subtotal,
        // Clamped: the discount was computed against the basket as it stood
        // when the code was applied, and lines can be removed afterwards.
        discount: Math.min(promoDiscount, subtotal),
        serviceChargePercent: config.serviceChargePercent,
        // Deliberately 0 — the fee is quoted by the restaurant on confirmation
        // (§4). The UI renders "à confirmer", never "0 FCFA".
        deliveryFee: 0,
        loyaltyValue,
      }),
    [subtotal, promoDiscount, config.serviceChargePercent, loyaltyValue],
  );

  const addLine = useCallback((line: Omit<CartLine, "id">) => {
    const id = optionsHash(line.menuItemId, line.options);
    const current = getSnapshot();

    /**
     * ONE RESTAURANT PER BASKET.
     *
     * An order is a row with a single restaurant_id; a basket spanning two
     * kitchens cannot become one order, and discovering that at checkout is
     * far worse than replacing the basket here.
     */
    const base = current.length && current[0].restaurantId !== line.restaurantId ? EMPTY : current;

    // Same item + same options → one line, higher quantity. Different options
    // → a separate line. That is what options_hash buys us.
    const existing = base.find((l) => l.id === id);
    writeCart(
      existing
        ? base.map((l) => (l.id === id ? { ...l, quantity: l.quantity + line.quantity } : l))
        : [...base, { ...line, id }],
    );
  }, []);

  const setQuantity = useCallback((id: string, quantity: number) => {
    writeCart(
      getSnapshot().map((l) =>
        l.id === id ? { ...l, quantity: Math.max(1, Math.min(50, quantity)) } : l,
      ),
    );
  }, []);

  const removeLine = useCallback((id: string) => {
    writeCart(getSnapshot().filter((l) => l.id !== id));
  }, []);

  const clearPromo = useCallback(() => {
    setPromoCode(null);
    setPromoLabel(null);
    setPromoDiscount(0);
    setPromoError(null);
    setPromoMinimum(null);
  }, []);

  const clear = useCallback(() => {
    writeCart(EMPTY);
    clearPromo();
    setLoyaltyPointsUsed(0);
  }, [clearPromo]);

  const applyPromo = useCallback(
    (code: string) => {
      if (!restaurantId) return setPromoError("unknown");

      startPromo(async () => {
        const result = await validatePromoCode({ code, restaurantId, subtotal });

        if (!result.ok) {
          setPromoCode(null);
          setPromoLabel(null);
          setPromoDiscount(0);
          setPromoMinimum(result.minimum ?? null);
          setPromoError(result.reason);
          return;
        }

        setPromoError(null);
        setPromoMinimum(null);
        setPromoCode(result.code);
        setPromoLabel(result.label);
        setPromoDiscount(result.discount);
      });
    },
    [restaurantId, subtotal],
  );

  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const value = useMemo(
    () => ({
      lines,
      itemCount,
      restaurantId,
      promoCode,
      promoLabel,
      promoError,
      promoMinimum,
      promoPending,
      loyaltyPointsUsed,
      totals,
      config,
      ready,
      addLine,
      setQuantity,
      removeLine,
      clear,
      applyPromo,
      removePromo: clearPromo,
      setLoyaltyPointsUsed,
    }),
    [
      lines,
      itemCount,
      restaurantId,
      promoCode,
      promoLabel,
      promoError,
      promoMinimum,
      promoPending,
      loyaltyPointsUsed,
      totals,
      config,
      ready,
      addLine,
      setQuantity,
      removeLine,
      clear,
      applyPromo,
      clearPromo,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
