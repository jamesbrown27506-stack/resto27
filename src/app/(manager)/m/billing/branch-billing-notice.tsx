"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { switchBranch } from "@/lib/data/manager-actions";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * /m/billing, seen from a branch (0072).
 *
 * The branch's plan is its main's, so there is nothing to choose or pay
 * here. Switching to the main and refreshing lands the owner on the real
 * billing page without leaving the URL they asked for.
 */
export function BranchBillingNotice({
  label,
  planName,
  mainId,
  canSwitch,
}: {
  label: string;
  planName: string;
  mainId: string;
  /** False when this person is not on the main restaurant's roster. */
  canSwitch: boolean;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function goToMain() {
    startTransition(async () => {
      const result = await switchBranch(mainId);
      if (!result.ok) return toast(result.error, "error");
      router.refresh();
    });
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardBody className="py-12 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary-light text-primary">
          <Building2 className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 font-display text-xl font-bold">{t("mbr.billing.title")}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
          {t("mbr.billing.body", { label, plan: planName })}
        </p>
        {canSwitch && (
          <Button size="lg" className="mt-6 w-full sm:w-auto" loading={pending} onClick={goToMain}>
            <span>{t("mbr.billing.cta")}</span>
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
