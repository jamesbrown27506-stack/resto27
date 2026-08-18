import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Mail, MapPin, MessageSquare, Phone } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { SectionTag } from "@/components/ui/badge";
import { getTranslator } from "@/lib/i18n/locale-server";
import { getHeaderUser } from "@/lib/auth/header-user";
import { planCtaHref } from "@/lib/nav";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact et assistance",
  description:
    "Une question sur une commande, un abonnement ou l'inscription de votre restaurant ? Écrivez-nous, nous répondons sous 24 heures.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const t = await getTranslator();
  const user = await getHeaderUser();

  return (
    <div className="container-page py-14 lg:py-20">
      <header className="max-w-2xl">
        <SectionTag>{t("mk.contact.tag")}</SectionTag>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">
          {t("mk.contact.title")}
        </h1>
        <p className="mt-4 text-lg text-text-secondary">{t("mk.contact.subtitle")}</p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardBody className="sm:p-8">
            <ContactForm />
          </CardBody>
        </Card>

        <aside className="flex flex-col gap-5">
          <Card>
            <CardBody>
              <h2 className="font-display text-lg font-bold">{t("mk.contact.reach")}</h2>
              <ul className="mt-4 flex flex-col gap-4 text-sm">
                {[
                  {
                    Icon: Mail,
                    label: t("mk.contact.emailLabel"),
                    value: "contact@restolink.cm",
                    href: "mailto:contact@restolink.cm",
                  },
                  {
                    Icon: Phone,
                    label: t("mk.contact.phoneLabel"),
                    value: "+237 6 99 00 00 00",
                    href: "tel:+237699000000",
                  },
                  {
                    Icon: MapPin,
                    label: t("mk.contact.addressLabel"),
                    value: "Akwa, Douala, Cameroun",
                  },
                  { Icon: Clock, label: t("mk.contact.hoursLabel"), value: t("mk.contact.hoursValue") },
                ].map(({ Icon, label, value, href }) => (
                  <li key={label} className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold tracking-wide text-text-light uppercase">
                        {label}
                      </span>
                      {href ? (
                        <a href={href} className="break-words hover:text-primary">
                          {value}
                        </a>
                      ) : (
                        <span className="break-words">{value}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card className="bg-primary-light">
            <CardBody>
              <MessageSquare className="size-5 text-primary" aria-hidden />
              <h2 className="mt-3 font-display text-lg font-bold">{t("mk.contact.ownerTitle")}</h2>
              <p className="mt-1.5 text-sm text-text-secondary">{t("mk.contact.ownerBody")}</p>
              <Link
                href={planCtaHref(user?.area ?? null)}
                className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4"
              >
                {t("mk.contact.ownerCta")}
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
