import Link from "next/link";
import PublicLink from "@/components/layout/public-link";
import { Bike, CalendarCheck, CalendarPlus, ChevronRight, Gift, Heart, Plus, RotateCcw, Search, Star, Ticket, Utensils } from "lucide-react";
import { ReorderButton } from "@/components/order/reorder-button";
import { PayCountdown } from "./pay-countdown";
import { ConfirmReceivedButton } from "./confirm-received-button";
import { buttonClasses } from "@/components/ui/button";
import { getLocale, getTranslator } from "@/lib/i18n/locale-server";
import { formatMoney } from "@/lib/format/currency";
import { formatDayLabel, formatTime } from "@/lib/format/datetime";
import { orderStatusMeta, type OrderStatus } from "@/lib/format/order-status";
import { formatQuartier } from "@/lib/geo-cm";
import { cn } from "@/lib/utils";
import type { CustomerHomeData, FeaturedRestaurant, HomeBooking } from "@/lib/data/customer-home";
import type { CustomerOrder } from "@/lib/data/customer";
import type { TimedOrder } from "@/lib/customer-home/sections";

type T = Awaited<ReturnType<typeof getTranslator>>;

/**
 * The home of a signed-in customer — on the site and in the app, which loads
 * the site.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  STRAIGHT TO THE POINT.
 *
 *  A signed-in customer used to land on the visitor's pitch: the hero, the
 *  stats, the section for restaurant owners, the plans and the FAQ. None of
 *  it is for someone who already orders here. Now the top of the screen is
 *  whatever they are part of right now — an order to pay before it is
 *  cancelled, one being cooked, a table tonight — and below it the food:
 *  dishes first (the Restaurants tab is one tap away), then the restaurants,
 *  both in the platform's placement order (lib/discovery/placement).
 *
 *  Visitors and search engines still get the marketing homepage: this is
 *  rendered only for a signed-in customer (see app/(public)/page.tsx).
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function CustomerHome({ name, data }: { name: string | null; data: CustomerHomeData }) {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  const loc = locale === "en" ? "en-CM" : "fr-CM";
  const firstName = name?.trim().split(/\s+/)[0] ?? "";

  const owesSomething = data.toPay.length > 0 || data.bookings.some(({ booking }) => booking.status === "awaiting_payment");
  const hasLive = owesSomething || data.waiting.length > 0 || data.inProgress.length > 0 || data.bookings.length > 0;

  return (
    <div className="container-page flex flex-col gap-8 pt-4 pb-10 sm:pt-8">
      {/*
        WHAT NEEDS YOU COMES FIRST.

        When an order waits for payment, is being cooked or a table is coming
        up, that is the first thing on the screen — above the greeting and the
        search, which are for someone with nothing going on. The greeting
        stays the page's heading for screen readers either way.
      */}
      {hasLive ? (
        <>
          <h1 className="sr-only">{firstName ? t("chm.greeting", { name: firstName }) : t("chm.greetingNoName")}</h1>
          <section aria-labelledby="home-now" className="flex flex-col gap-3">
            <h2 id="home-now" className="text-xs font-bold tracking-widest text-text-secondary uppercase">
              {owesSomething ? t("chm.now.title") : t("chm.now.inProgress")}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {data.toPay.map((item) => (
                <PayCard key={item.order.id} item={item} orderMinutes={data.orderMinutes} t={t} loc={loc} />
              ))}
              {data.waiting.map((item) => (
                <WaitCard key={item.order.id} item={item} t={t} />
              ))}
              {data.inProgress.map((order) => (
                <TrackCard key={order.id} order={order} t={t} />
              ))}
              {data.bookings.map((item) => (
                <BookingCard key={item.booking.id} item={item} t={t} loc={loc} />
              ))}
            </div>
          </section>
          <SearchBox t={t} />
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-display text-3xl leading-tight font-bold">
              {firstName ? t("chm.greeting", { name: firstName }) : t("chm.greetingNoName")}
            </h1>
            <p className="mt-1 text-text-secondary">{t("chm.prompt")}</p>
          </div>
          <SearchBox t={t} />
        </div>
      )}

      {data.cravings.length > 0 && (
        <section aria-labelledby="home-cravings" className="flex flex-col gap-3">
          <SectionHead id="home-cravings" title={t("chm.cravings.title")} href="/explore" linkLabel={t("chm.cravings.all")} />
          <Scroller>
            {data.cravings.map((dish) => (
              <PublicLink key={dish.slug} href={`/explore/food/${dish.slug}`} className="group flex w-28 shrink-0 snap-start flex-col gap-1.5">
                <Photo src={dish.imageUrl} className="size-28 rounded-lg" />
                <span className="truncate text-sm font-bold">{dish.name}</span>
                <span className="-mt-1 text-xs text-text-light">
                  {dish.restaurantCount === 1
                    ? t("chm.cravings.oneRestaurant")
                    : t("chm.cravings.restaurants", { count: dish.restaurantCount })}
                </span>
              </PublicLink>
            ))}
          </Scroller>
        </section>
      )}

      <nav aria-label={t("chm.short.label")} className="grid grid-cols-4 gap-2.5">
        <Shortcut href="/orders" label={t("chm.short.reorder")}>
          <RotateCcw className="size-5.5 text-primary" aria-hidden />
        </Shortcut>
        <Shortcut href="/favorites" label={t("chm.short.favorites")}>
          <Heart className="size-5.5 text-primary" aria-hidden />
        </Shortcut>
        <Shortcut href="/restaurants" label={t("chm.short.book")}>
          <CalendarPlus className="size-5.5 text-primary" aria-hidden />
        </Shortcut>
        <Shortcut href="/loyalty" label={t("chm.short.points")}>
          {data.points !== null ? (
            <span className="tnum text-lg leading-none font-bold text-accent">{data.points.toLocaleString(loc)}</span>
          ) : (
            <Gift className="size-5.5 text-primary" aria-hidden />
          )}
        </Shortcut>
      </nav>

      {data.reorder.length > 0 && (
        <section aria-labelledby="home-reorder" className="flex flex-col gap-3">
          <SectionHead id="home-reorder" title={t("chm.reorder.title")} href="/orders" linkLabel={t("chm.reorder.all")} />
          <Scroller>
            {data.reorder.map((order) => (
              <article key={order.id} className="flex w-64 max-w-[78vw] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-surface">
                <Photo src={data.reorderImages[order.id] ?? null} className="h-24 w-full" />
                <div className="flex flex-1 flex-col gap-0.5 p-3">
                  <h3 className="truncate font-bold">{order.restaurantName}</h3>
                  <p className="truncate text-sm text-text-secondary">{itemsLabel(order)}</p>
                  <p className="text-xs text-text-light">{formatDayLabel(order.createdAt, loc)}</p>
                  {/* Price, then the button on its own full-width row: side by
                      side, "Commander à nouveau" ran out of the card. */}
                  <div className="mt-auto flex flex-col gap-2 pt-2">
                    <span translate="no" className="tnum font-bold">{formatMoney(order.total)}</span>
                    <ReorderButton
                      fullWidth
                      restaurantSlug={order.restaurantSlug}
                      lines={order.items.map((item) => ({
                        menuItemId: item.menuItemId,
                        name: item.name,
                        quantity: item.quantity,
                        options: item.optionsLabel,
                        notes: item.notes,
                      }))}
                    />
                  </div>
                </div>
              </article>
            ))}
          </Scroller>
        </section>
      )}

      {data.menu.length > 0 && (
        <section aria-labelledby="home-menu" className="flex flex-col gap-3">
          <div>
            <h2 id="home-menu" className="font-display text-2xl font-bold">{t("chm.menu.title")}</h2>
            <p className="mt-0.5 text-sm text-text-secondary">{t("chm.menu.subtitle")}</p>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.menu.map((dish) => (
              <li key={dish.id}>
                <PublicLink
                  href={dish.href}
                  aria-label={t("chm.menu.open", { dish: dish.name })}
                  className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface transition-shadow hover:shadow-md"
                >
                  <Photo src={dish.imageUrl} className="aspect-[4/3] w-full" zoom />
                  <span className="flex flex-1 flex-col gap-0.5 p-3">
                    <span className="line-clamp-2 font-bold leading-snug">{dish.name}</span>
                    <span className="truncate text-sm text-text-secondary">{dish.restaurantName}</span>
                    <span className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <span translate="no" className="tnum font-bold">{formatMoney(dish.price)}</span>
                      <span aria-hidden className="grid size-10 place-items-center rounded-full bg-primary text-primary-fg">
                        <Plus className="size-5" />
                      </span>
                    </span>
                  </span>
                </PublicLink>
              </li>
            ))}
          </ul>
          <PublicLink href="/explore" className={buttonClasses({ variant: "outline", fullWidth: true })}>
            {t("chm.menu.all")}
          </PublicLink>
        </section>
      )}

      {data.featured.length > 0 && (
        <section aria-labelledby="home-featured" className="flex flex-col gap-3">
          <SectionHead id="home-featured" title={t("chm.featured.title")} href="/restaurants" linkLabel={t("chm.featured.all")} />
          <Scroller wideGrid>
            {data.featured.map((item) => (
              <FeaturedCard key={item.restaurant.id} item={item} t={t} />
            ))}
          </Scroller>
        </section>
      )}
    </div>
  );
}

/* ── Cards on top ──────────────────────────────────────────────────────── */

function PayCard({ item, orderMinutes, t, loc }: { item: TimedOrder<CustomerOrder>; orderMinutes: number; t: T; loc: string }) {
  const { order, deadline, minutesLeft } = item;
  // Same rule as the order page: online money is asked for online.
  const canPay = order.paymentMethod === "mobile_money" || order.paymentMethod === "wallet";

  return (
    <article className="rounded-lg border-2 border-primary bg-surface p-4 shadow-md sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-primary-light px-2.5 py-0.5 text-[13px] font-bold text-primary">{t("chm.pay.badge")}</span>
        <span className="font-mono text-xs text-text-light">{order.reference}</span>
      </div>
      <h3 className="mt-3 text-lg leading-snug font-bold">{t("chm.pay.title", { restaurant: order.restaurantName })}</h3>
      <p className="mt-1 text-sm text-text-secondary">{t("chm.pay.body")}</p>
      {deadline && (
        <PayCountdown
          deadline={deadline}
          totalMinutes={orderMinutes}
          initialMinutes={minutesLeft}
          beforeLabel={t("chm.pay.before", { time: formatTime(deadline, loc) })}
        />
      )}
      <div className="mt-4 flex flex-col gap-1.5 rounded-md bg-bg p-3 text-sm">
        <p className="truncate text-text-secondary">{itemsLabel(order)}</p>
        <p className="flex items-center justify-between gap-3 border-t border-border pt-1.5 text-base font-bold">
          <span>{t("chm.pay.total")}</span>
          <span translate="no" className="tnum">{formatMoney(order.total)}</span>
        </p>
        {order.type === "delivery" && <DeliveryNote order={order} t={t} />}
      </div>
      <Link
        href={canPay ? `/orders/${order.id}?pay=1` : `/orders/${order.id}`}
        className={buttonClasses({ size: "lg", fullWidth: true, className: "mt-4" })}
      >
        {canPay ? t("chm.pay.cta") : t("chm.pay.open")}
      </Link>
    </article>
  );
}

function WaitCard({ item, t }: { item: TimedOrder<CustomerOrder>; t: T }) {
  const { order } = item;
  return (
    <Link href={`/orders/${order.id}`} className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-warning-light px-2.5 py-0.5 text-[13px] font-bold text-warning">{t("chm.wait.badge")}</span>
          <span className="font-mono text-xs text-text-light">{order.reference}</span>
        </span>
        <span className="mt-2 block font-bold">{t("chm.wait.title", { restaurant: order.restaurantName })}</span>
        <span className="mt-0.5 block text-sm text-text-secondary">{t("chm.wait.body")}</span>
      </span>
      <ChevronRight className="mt-8 size-5 shrink-0 text-text-light transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

const TRACK_STEPS: OrderStatus[] = ["confirmed", "preparing", "shipped", "delivered"];

function TrackCard({ order, t }: { order: CustomerOrder; t: T }) {
  // A paid order caught between two writes reads as confirmed.
  const status: OrderStatus = order.status === "awaiting_customer" ? "confirmed" : order.status;
  const meta = orderStatusMeta(status, order.type);
  const current = TRACK_STEPS.indexOf(status);

  return (
    <article className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className={cn("rounded-full px-2.5 py-0.5 text-[13px] font-bold", meta.badge)}>{t(meta.labelKey)}</span>
        <span className="font-mono text-xs text-text-light">{order.reference}</span>
      </div>
      <h3 className="mt-3 text-lg leading-snug font-bold">{t("chm.track.title", { restaurant: order.restaurantName })}</h3>
      <p className="mt-1 text-sm text-text-secondary">{t(meta.descKey)}</p>
      <ol className="mt-4 grid grid-cols-4 gap-1.5">
        {TRACK_STEPS.map((step, index) => (
          <li key={step} className="flex flex-col gap-1.5">
            <span
              aria-hidden
              className={cn(
                "h-1.5 rounded-full",
                index < current ? "bg-success" : index === current ? "bg-info" : "bg-border",
              )}
            />
            <span
              aria-current={index === current ? "step" : undefined}
              className={cn(
                "text-[11px] leading-tight",
                index < current ? "font-semibold text-success" : index === current ? "font-bold text-info" : "text-text-light",
              )}
            >
              {t(orderStatusMeta(step, order.type).labelKey)}
            </span>
          </li>
        ))}
      </ol>
      {(order.isPaid || order.type === "delivery") && (
        <div className="mt-4 flex flex-col gap-1 rounded-md bg-bg px-3 py-2.5 text-sm text-text-secondary">
          {order.isPaid && (
            <span translate="no" className="tnum">{t("chm.track.paid", { amount: formatMoney(order.total) })}</span>
          )}
          {order.type === "delivery" && <DeliveryNote order={order} t={t} />}
        </div>
      )}
      {/* On its way / ready to collect: the customer closes it themselves,
          right here, without waiting for the restaurant to ask. */}
      {status === "shipped" && order.type !== "dine_in" ? (
        <div className="mt-4 flex flex-col gap-2">
          <ConfirmReceivedButton orderId={order.id} pickup={order.type === "pickup"} />
          <Link href={`/orders/${order.id}`} className={buttonClasses({ variant: "outline", fullWidth: true })}>
            {t("chm.track.cta")}
          </Link>
        </div>
      ) : (
        <Link href={`/orders/${order.id}`} className={buttonClasses({ size: "lg", fullWidth: true, className: "mt-4" })}>
          {t("chm.track.cta")}
        </Link>
      )}
    </article>
  );
}

function BookingCard({ item, t, loc }: { item: HomeBooking; t: T; loc: string }) {
  const { booking, day } = item;
  const time = formatTime(booking.reservedFor, loc);
  const when =
    day === "today"
      ? t("chm.booking.today", { time })
      : day === "tomorrow"
        ? t("chm.booking.tomorrow", { time })
        : t("chm.booking.on", { day: formatDayLabel(booking.reservedFor, loc), time });
  const owed = booking.status === "awaiting_payment" && !booking.depositPaid && booking.depositAmount > 0;
  const voucher = booking.status === "confirmed" && booking.voucherCode ? booking.voucherCode : null;

  return (
    <article
      className={cn(
        "flex items-center gap-3.5 rounded-lg border bg-surface p-3.5",
        owed ? "border-2 border-primary shadow-md" : "border-border",
      )}
    >
      <span className="grid size-13 shrink-0 place-items-center rounded-md bg-success-light text-accent">
        <CalendarCheck className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold">{when}</h3>
        <p className="truncate text-sm text-text-secondary">
          {t("chm.booking.party", { restaurant: booking.restaurantName, count: booking.partySize })}
        </p>
        {owed ? (
          <p translate="no" className="tnum text-xs font-semibold text-primary">
            {t("chm.booking.depositDue", { amount: formatMoney(booking.depositAmount) })}
          </p>
        ) : booking.status === "pending" ? (
          <p className="text-xs text-text-light">{t("chm.booking.pending")}</p>
        ) : voucher ? (
          <p className="font-mono text-xs tracking-wide text-text-light">{voucher}</p>
        ) : null}
      </div>
      {voucher ? (
        <Link href={`/v/${voucher}`} className={buttonClasses({ variant: "accent", className: "shrink-0" })}>
          <Ticket className="size-4" aria-hidden />
          {t("chm.booking.voucher")}
        </Link>
      ) : (
        <Link href="/reservations" className={buttonClasses({ variant: owed ? "primary" : "outline", className: "shrink-0" })}>
          {owed ? t("chm.booking.pay") : t("chm.booking.open")}
        </Link>
      )}
    </article>
  );
}

function DeliveryNote({ order, t }: { order: CustomerOrder; t: T }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-text-secondary">
      <Bike className="size-4 shrink-0" aria-hidden />
      <span translate="no">
        {order.deliveryFeeSetAt && order.deliveryFee > 0
          ? t("chm.pay.deliveryCash", { amount: formatMoney(order.deliveryFee) })
          : t("chm.pay.deliveryLater")}
      </span>
    </span>
  );
}

/* ── The food ──────────────────────────────────────────────────────────── */

function FeaturedCard({ item, t }: { item: FeaturedRestaurant; t: T }) {
  const { restaurant: r, openNow } = item;
  const place = [r.cuisine, formatQuartier(r.quartier)].filter(Boolean).join(" · ");

  return (
    <PublicLink
      href={`/restaurants/${r.slug}`}
      className="group flex w-68 shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-surface transition-shadow hover:shadow-md lg:w-auto"
    >
      {/* The logo sits IN the banner, bottom-left. Hung below it with a
          negative margin it slid under the cover: the banner is positioned,
          the logo was not, so the banner painted over it. */}
      <span className="relative block">
        <Photo src={r.coverUrl} className="h-28 w-full" zoom />
        {r.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.logoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute bottom-2 left-2 z-10 size-12 rounded-full border-2 border-surface bg-surface object-cover shadow-md"
          />
        ) : (
          <span
            aria-hidden
            className="absolute bottom-2 left-2 z-10 grid size-12 place-items-center rounded-full border-2 border-surface bg-primary-light font-display text-lg font-bold text-primary shadow-md"
          >
            {r.name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-0.5 px-3.5 pt-2.5 pb-3.5">
        <span className="truncate font-bold">{r.name}</span>
        {place && <span className="truncate text-sm text-text-secondary">{place}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
          {r.reviewCount > 0 ? (
            <span className="tnum flex items-center gap-1 font-bold">
              <Star className="size-3.5 fill-warning text-warning" aria-hidden />
              {r.rating.toFixed(1)}
            </span>
          ) : (
            <span className="rounded-full bg-success-light px-2 font-semibold text-accent">{t("chm.featured.new")}</span>
          )}
          <span className={cn("font-semibold", openNow ? "text-success" : "text-text-light")}>
            {openNow ? t("chm.featured.open") : t("chm.featured.closed")}
          </span>
          {r.acceptsDelivery && r.deliveryEstimateMin > 0 && (
            <span className="tnum text-text-secondary">{t("chm.featured.minutes", { min: r.deliveryEstimateMin })}</span>
          )}
        </span>
      </span>
    </PublicLink>
  );
}

/* ── Small parts ───────────────────────────────────────────────────────── */

/** Search sends to the directory, which already reads ?q= (dishes included). */
function SearchBox({ t }: { t: T }) {
  return (
    <form action="/restaurants" method="get" role="search" className="relative">
      <label htmlFor="home-search" className="sr-only">
        {t("chm.search.label")}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-light" aria-hidden />
      <input
        id="home-search"
        name="q"
        type="search"
        enterKeyHint="search"
        placeholder={t("chm.search.placeholder")}
        className="h-13 w-full rounded-md border border-border-strong bg-surface pr-4 pl-12 text-base text-text placeholder:text-text-light focus:border-primary focus:outline-none"
      />
    </form>
  );
}

function SectionHead({ id, title, href, linkLabel }: { id: string; title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="font-display text-2xl font-bold">
        {title}
      </h2>
      <PublicLink href={href} className="flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
        {linkLabel}
      </PublicLink>
    </div>
  );
}

/** A row that scrolls sideways on a phone; `wideGrid` turns it into a grid on large screens. */
function Scroller({ children, wideGrid = false }: { children: React.ReactNode; wideGrid?: boolean }) {
  return (
    <div
      className={cn(
        "-mx-6 flex snap-x gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none]",
        wideGrid && "lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0",
      )}
    >
      {children}
    </div>
  );
}

function Shortcut({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-1 text-center text-xs font-semibold text-text transition-colors hover:border-primary/40"
    >
      {children}
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}

/** A dish or cover photo, or a quiet tile with a fork when there is none. */
function Photo({ src, className, zoom = false }: { src: string | null; className?: string; zoom?: boolean }) {
  return (
    <span className={cn("relative block shrink-0 overflow-hidden bg-primary-light", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn("size-full object-cover", zoom && "transition-transform duration-500 group-hover:scale-105")}
        />
      ) : (
        <span className="grid size-full place-items-center text-primary/60">
          <Utensils className="size-7" aria-hidden />
        </span>
      )}
    </span>
  );
}

/** "Ekwang ×2, Koki" — the order's dishes, as the cards summarise them. */
function itemsLabel(order: CustomerOrder): string {
  return order.items.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name)).join(", ");
}
