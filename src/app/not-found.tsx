import Link from "next/link";
import { Search, UtensilsCrossed } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-dvh flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-primary-light text-primary">
        <UtensilsCrossed className="size-6" aria-hidden />
      </span>

      <p className="font-display text-5xl font-bold text-primary">404</p>
      <h1 className="font-display text-3xl font-bold">Page introuvable</h1>
      <p className="max-w-md leading-relaxed text-text-secondary">
        Cette page n&apos;existe pas ou a été déplacée. Le restaurant que vous cherchez a peut-être
        changé d&apos;adresse.
      </p>

      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link href="/restaurants" className={buttonClasses()}>
          <Search className="size-4" aria-hidden />
          Voir les restaurants
        </Link>
        <Link href="/" className={buttonClasses({ variant: "outline" })}>
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
