"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";

/**
 * Global error boundary.
 *
 * Deliberately does NOT print the raw error message: it can contain a
 * connection string, a query fragment or a user's email. The digest is enough
 * to correlate with server logs, and is safe to show.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-page flex min-h-dvh flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-error-light text-error">
        <AlertTriangle className="size-6" aria-hidden />
      </span>

      <h1 className="font-display text-3xl font-bold">Une erreur est survenue</h1>
      <p className="max-w-md leading-relaxed text-text-secondary">
        Quelque chose s&apos;est mal passé de notre côté. Réessayez — si le problème persiste,
        écrivez-nous en mentionnant la référence ci-dessous.
      </p>

      {error.digest && (
        <p className="tnum rounded-md bg-surface-2 px-3 py-1.5 font-mono text-xs text-text-light">
          {error.digest}
        </p>
      )}

      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden />
          Réessayer
        </Button>
        <Link href="/" className={buttonClasses({ variant: "outline" })}>
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
