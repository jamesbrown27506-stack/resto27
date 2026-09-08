"use client";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/use-locale";
import { CUSTOMER_NAV } from "@/lib/nav";
import { NavIcon, type IconName } from "./icon";

export function AccountLinks() {
  const { t, locale } = useLocale();
  const fr = locale === "fr";
  const groups = [
    { title: fr ? "Mes activités" : "My activity", paths: ["/orders", "/messages", "/reservations", "/favorites", "/reviews"] },
    { title: fr ? "Mon compte" : "My account", paths: ["/addresses", "/loyalty", "/profile", "/settings"] },
  ];
  return <nav aria-label={fr ? "Mon compte" : "My account"} className="mb-8 space-y-4">
    {groups.map(group => <section key={group.title}>
      <h2 className="mb-2 text-sm font-semibold text-text-secondary">{group.title}</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CUSTOMER_NAV.filter(item => group.paths.includes(item.href)).map(item => <li key={item.href}>
          <Link href={item.href} className="flex min-h-12 items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm font-medium hover:bg-surface-2">
            <NavIcon name={item.icon as IconName} className="size-4 shrink-0" />{item.labelKey ? t(item.labelKey) : item.label}
          </Link>
        </li>)}
      </ul>
    </section>)}
  </nav>;
}
