"use client";
import Link from "./public-link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";

export function PageBackLink({ home = "/account" }: { home?: string }) {
  const pathname = usePathname();
  const { locale } = useLocale();
  if (pathname === home) return null;
  const parts = pathname.split("/").filter(Boolean);
  const href = parts.length > (home === "/m" ? 2 : 1) ? "/" + parts.slice(0, home === "/m" ? 2 : 1).join("/") : home;
  return <Link href={href} className="mb-4 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary">
    <ArrowLeft className="size-4" />{locale === "fr" ? "Retour" : "Back"}
  </Link>;
}
