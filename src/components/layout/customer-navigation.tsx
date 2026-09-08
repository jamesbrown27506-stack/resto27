"use client";
import { MobileTabBar } from "./mobile-tabbar";
import { useLocale } from "@/lib/i18n/use-locale";

export function CustomerNavigation({ accountHref = "/account" }: { accountHref?: string }) {
  const { locale } = useLocale();
  const fr = locale === "fr";
  return <MobileTabBar items={[
    { href: "/", icon: "Home", label: fr ? "Accueil" : "Home" },
    { href: "/restaurants", icon: "Search", label: fr ? "Explorer" : "Explore", matchPrefix: true },
    { href: "/orders", icon: "ReceiptText", label: fr ? "Commandes" : "Orders", matchPrefix: true },
    { href: "/messages", icon: "MessageSquare", label: "Messages", matchPrefix: true },
    { href: accountHref, activePaths: ["/account", "/settings", "/profile", "/addresses", "/loyalty", "/reviews", "/favorites", "/reservations"], icon: "User", label: fr ? "Compte" : "Account" },
  ]} />;
}
