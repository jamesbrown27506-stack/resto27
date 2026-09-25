"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setAcceptingOrders } from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * One tap to stop taking orders, one tap to start again (`service.pause`).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY IT LEFT THE SETTINGS PAGE.
 *
 *  The pause lived only on /m/settings, three screens away from the queue.
 *  A kitchen that is drowning at 20:30 does not go looking for Settings —
 *  it stops answering, and every unanswered order now rings for fifteen
 *  minutes and is then cancelled on the customer. Putting the switch where
 *  the flood is visible (dashboard, orders queue) makes "pause" the easy
 *  answer instead of "ignore".
 *
 *  No reason is asked for here: the settings page still offers one, and a
 *  dialog in front of a one-tap emergency brake defeats its purpose. The
 *  shell's paused banner makes the state impossible to forget.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function ServicePauseToggle({
  accepting,
  size = "sm",
}: {
  /** The branch's `is_accepting_orders`, from the server render. */
  accepting: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setAcceptingOrders(!accepting);
      if (!result.ok) return toast(t("mops.pause.failed"), "error");
      toast(accepting ? t("mops.pause.paused") : t("mops.pause.resumed"), accepting ? "info" : "success");
      router.refresh();
    });
  }

  return (
    <Button
      variant={accepting ? "outline" : "primary"}
      size={size}
      loading={pending}
      disabled={pending}
      onClick={toggle}
      className="min-h-11"
    >
      {accepting ? (
        <PauseCircle className="size-4" aria-hidden />
      ) : (
        <PlayCircle className="size-4" aria-hidden />
      )}
      <span>{accepting ? t("mops.pause.pause") : t("mops.pause.resume")}</span>
    </Button>
  );
}
