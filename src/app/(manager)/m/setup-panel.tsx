"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bike,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Sparkles,
  Store,
  Table2,
  Clock,
  UtensilsCrossed,
} from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { setDeliveryOffering } from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { SetupChecklist } from "@/lib/data/manager";
import { cn } from "@/lib/utils";

/**
 * "FINISH SETTING UP YOUR RESTAURANT" — the dashboard's second half.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS IS NOT IN THE WIZARD.
 *
 *  The onboarding wizard is five short steps on purpose: a long one is where
 *  restaurant signups are abandoned. So it never asks for a logo, a cover
 *  photo, a description or a cuisine — and a brand-new restaurant therefore
 *  goes live looking anonymous, a grey placeholder in a directory of
 *  photographs.
 *
 *  This panel is the other half of that trade. Everything the wizard skipped
 *  lives here, as a checklist rather than a gate: each row is "your page
 *  would be better with this", never "you cannot trade without it". A
 *  restaurant that wants to open first and decorate later can, and the panel
 *  disappears on its own once every row is ticked.
 *
 *  ARRIVING FROM ONBOARDING SCROLLS HERE. `?welcome=1` is set by the last
 *  step of the wizard, and the scroll is what connects "I just finished
 *  setup" to "here is what is still worth doing" — otherwise the panel sits
 *  below the fold of a dashboard nobody has learned to scroll yet.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function SetupPanel({
  checklist,
  canEditProfile,
}: {
  checklist: SetupChecklist;
  /** `profile.edit` — waiters see the checklist read-only, without the toggle. */
  canEditProfile: boolean;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [delivers, setDelivers] = useState(checklist.acceptsDelivery);
  const sectionRef = useRef<HTMLElement>(null);

  const items = [
    {
      done: checklist.hasLogo,
      icon: ImageIcon,
      labelKey: "m.setup.logo",
      bodyKey: "m.setup.logoBody",
      href: "/m/profile",
    },
    {
      done: checklist.hasCover,
      icon: ImageIcon,
      labelKey: "m.setup.cover",
      bodyKey: "m.setup.coverBody",
      href: "/m/profile",
    },
    {
      done: checklist.hasDescription,
      icon: Store,
      labelKey: "m.setup.description",
      bodyKey: "m.setup.descriptionBody",
      href: "/m/profile",
    },
    {
      done: checklist.hasCuisine,
      icon: UtensilsCrossed,
      labelKey: "m.setup.cuisine",
      bodyKey: "m.setup.cuisineBody",
      href: "/m/profile",
    },
    {
      done: checklist.hasMenu,
      icon: UtensilsCrossed,
      labelKey: "m.setup.menu",
      bodyKey: "m.setup.menuBody",
      href: "/m/menu",
    },
    {
      done: checklist.hasTables,
      icon: Table2,
      labelKey: "m.setup.tables",
      bodyKey: "m.setup.tablesBody",
      href: "/m/tables",
    },
    {
      done: checklist.hasHours,
      icon: Clock,
      labelKey: "m.setup.hours",
      bodyKey: "m.setup.hoursBody",
      href: "/m/profile",
    },
  ] as const;

  const doneCount = items.filter((i) => i.done).length;
  const complete = doneCount === items.length;

  /**
   * The arrival animation.
   *
   * `?welcome=1` only ever comes from the wizard's last step. The scroll is
   * deferred one frame so the dashboard has actually laid out — scrolling to
   * a node whose ancestors are still sizing lands somewhere arbitrary — and
   * the flag is stripped from the URL afterwards so a refresh, or a back
   * navigation an hour later, does not re-trigger it.
   *
   * `prefers-reduced-motion` is honoured: the panel is still brought into
   * view, just without the animated travel. Someone who has asked the OS to
   * stop moving things has asked for that here too.
   */
  useEffect(() => {
    if (params.get("welcome") !== "1") return;

    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    });

    // replace(), not push() — the welcome URL must not become a history entry
    // the back button can return to.
    const url = new URL(window.location.href);
    url.searchParams.delete("welcome");
    window.history.replaceState(null, "", url.pathname + url.search);

    return () => cancelAnimationFrame(frame);
  }, [params]);

  const justArrived = params.get("welcome") === "1";

  function toggleDelivery(next: boolean) {
    // Optimistic: the switch answers instantly and rolls back if the write
    // fails. A toggle that waits a round trip before moving reads as broken
    // and gets tapped twice.
    setDelivers(next);
    setSavingDelivery(true);
    startTransition(async () => {
      const result = await setDeliveryOffering({ offersDelivery: next });
      setSavingDelivery(false);
      if (!result.ok) {
        setDelivers(!next);
        return toast(result.error, "error");
      }
      toast(next ? t("m.setup.deliveryOn") : t("m.setup.deliveryOff"), "success");
      router.refresh();
    });
  }

  return (
    <section
      ref={sectionRef}
      id="finish-setup"
      // `scroll-mt` clears the sticky 56px header, so scrollIntoView does not
      // park the panel's own title underneath it.
      className="mt-6 scroll-mt-20"
    >
      <Card
        className={cn(
          "overflow-hidden",
          // A one-off highlight for the arrival from onboarding, so the thing
          // we just scrolled to is visibly the thing we scrolled to.
          justArrived && "ring-2 ring-primary/40",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold">
              <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
              <span>{complete ? t("m.setup.doneTitle") : t("m.setup.title")}</span>
            </h3>
            <p className="mt-0.5 text-sm text-text-secondary">
              {complete ? t("m.setup.doneBody") : t("m.setup.body")}
            </p>
          </div>
          <span className="tnum shrink-0 rounded-full bg-primary-light px-3 py-1 text-sm font-bold text-primary">
            {doneCount}/{items.length}
          </span>
        </div>

        {/* Progress bar — the same "how far along am I" the wizard gave them,
            carried over so finishing setup still feels like finishing. */}
        <div className="h-1 w-full bg-surface-2" aria-hidden>
          <div
            className="h-full bg-primary transition-all duration-700"
            style={{ width: `${(doneCount / items.length) * 100}%` }}
          />
        </div>

        <ul className="divide-y divide-border">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.labelKey}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 p-4 transition-colors hover:bg-surface-2",
                    item.done && "opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full",
                      item.done ? "bg-success-light text-success" : "bg-primary-light text-primary",
                    )}
                  >
                    {item.done ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <Icon className="size-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-sm font-semibold",
                        item.done && "line-through decoration-1",
                      )}
                    >
                      {t(item.labelKey as TranslationKey)}
                    </span>
                    {!item.done && (
                      <span className="mt-0.5 block text-xs text-text-secondary">
                        {t(item.bodyKey as TranslationKey)}
                      </span>
                    )}
                  </span>
                  {!item.done && (
                    <ChevronRight className="size-4 shrink-0 text-text-light" aria-hidden />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/*
          THE DELIVERY SWITCH.

          Asked once during onboarding, and changeable here forever after —
          which is the point. A restaurant whose only rider quits on a Tuesday
          needs to stop promising delivery on Tuesday, not file a support
          request. It writes accepts_delivery, the same column the public
          directory, the restaurant page and checkout all read.
        */}
        {canEditProfile && (
          <div className="border-t border-border bg-surface-2/50 p-4">
            <Switch
              checked={delivers}
              disabled={savingDelivery}
              onChange={(e) => toggleDelivery(e.target.checked)}
              label={t("m.setup.deliveryLabel")}
              description={
                delivers
                  ? checklist.hasOwnDelivery
                    ? t("m.setup.deliveryOwnHint")
                    : t("m.setup.deliveryPlatformHint")
                  : t("m.setup.deliveryOffHint")
              }
            />
            {delivers && (
              <Link
                href="/m/profile"
                className={buttonClasses({ variant: "ghost", size: "sm", className: "mt-2" })}
              >
                <Bike className="size-3.5" aria-hidden />
                {t("m.setup.deliverySettings")}
              </Link>
            )}
          </div>
        )}

        {!complete && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <p className="text-xs text-text-light">{t("m.setup.later")}</p>
            <Link href="/m/profile" className={buttonClasses({ size: "sm" })}>
              {t("m.setup.go")}
              <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        )}
      </Card>
    </section>
  );
}

/**
 * Nudges the brand-new restaurant DOWN to the panel above.
 *
 * Sits at the top of the dashboard on the welcome arrival only. Without it
 * the scroll happens with no explanation — the page simply moves on its own,
 * which reads as a glitch rather than as an invitation.
 */
export function WelcomeNudge() {
  const { t } = useLocale();
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  if (params.get("welcome") !== "1" || dismissed) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary-light p-4"
    >
      <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold text-primary">{t("m.welcome.title")}</span>{" "}
        <span className="text-text-secondary">{t("m.welcome.body")}</span>
      </p>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        {t("m.welcome.dismiss")}
      </Button>
    </div>
  );
}
