"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openCustomerConversation } from "@/lib/data/chat-actions";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * "Écrire au client" — a branch opening (or reusing) a thread with a customer.
 *
 * The rule lives on the server (openCustomerConversation): the customer must
 * be linked to the ACTIVE branch by an order or a reservation, and the staff
 * member must hold the capability that already shows them that link. This
 * button only decides where to offer the tap — hosts should render it where
 * such a link is on screen, and pass `customerId={null}` for a guest / table
 * order with no account behind it, which renders nothing.
 *
 * With an order or reservation id, `customerId` may be left out: the server
 * reads the customer from that row, which is also what proves the link.
 */
export function MessageCustomerButton({
  customerId,
  orderId,
  reservationId,
  label,
  variant = "outline",
  size = "md",
  className,
}: {
  /** null = known to have no account → nothing rendered. */
  customerId?: string | null;
  orderId?: string | null;
  reservationId?: string | null;
  /** Defaults to "Écrire au client". */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (customerId === null) return null;
  if (!customerId && !orderId && !reservationId) return null;

  function open() {
    startTransition(async () => {
      const result = await openCustomerConversation({ customerId, orderId, reservationId }).catch(() => null);
      if (!result) return toast(t("chat.err.failed"), "error");
      if (result.ok) {
        router.push(result.href);
        return;
      }
      const key = result.reason === "auth" ? "chat.err.session" : `chat.err.${result.reason}`;
      toast(t(key as TranslationKey) || result.error, "error");
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      loading={pending}
      onClick={open}
    >
      <MessageSquare className="size-4" aria-hidden />
      <span>{label ?? t("chat.messageCustomer")}</span>
    </Button>
  );
}
