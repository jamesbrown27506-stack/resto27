"use client";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/use-locale";
import { publicHref } from "@/lib/seo-config";

export default function PublicLink({ href, ...props }: React.ComponentProps<typeof Link>) {
  const { locale } = useLocale();
  return <Link {...props} href={typeof href === "string" ? publicHref(href, locale) : href} />;
}
