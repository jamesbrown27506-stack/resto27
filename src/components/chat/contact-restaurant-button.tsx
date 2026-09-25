"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openRestaurantConversation } from "@/lib/data/chat-actions";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * "Contacter le restaurant" — the customer's one tap into the in-app chat.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  SELF-CONTAINED ON PURPOSE.
 *
 *  It is dropped onto the public restaurant page (a cacheable page that does
 *  not know who is looking), the customer's order page and each booking. So
 *  it needs nothing from its host but ids: the server action works out who
 *  is asking, opens or reuses the right thread, and answers with where to go.
 *  An anonymous visitor is sent to sign in and brought back here — the tap
 *  is not lost, it is just one sign-in longer.
 *
 *  There is deliberately no phone or WhatsApp alternative next to it: the
 *  chat is the only channel between customers and restaurants.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function ContactRestaurantButton({
  restaurantId,
  orderId,
  reservationId,
  label,
  variant = "outline",
  size = "md",
  fullWidth = false,
  className,
}: {
  restaurantId: string;
  /** Thread about this order ("Commande CMD-XXXX" chip). Must be the customer's. */
  orderId?: string | null;
  /** Thread about this booking ("Réservation RES-XXXX" chip). Ignored when orderId is set. */
  reservationId?: string | null;
  /** Defaults to "Contacter le restaurant". */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function open() {
    startTransition(async () => {
      const result = await openRestaurantConversation({ restaurantId, orderId, reservationId }).catch(
        () => null,
      );
      if (!result) return toast(t("chat.err.failed"), "error");
      if (result.ok) {
        router.push(result.href);
        return;
      }
      if (result.reason === "auth") {
        router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }
      toast(t(`chat.err.${result.reason}` as TranslationKey) || result.error, "error");
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      className={className}
      loading={pending}
      onClick={open}
    >
      <MessageSquare className="size-4" aria-hidden />
      <span>{label ?? t("chat.contactRestaurant")}</span>
    </Button>
  );
}
