import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest needs the `@/…` alias spelled out for it.
 *
 * `tsconfig.json` maps `@/*` onto `src/*`, which is what the editor and the
 * Next build both read — but Vitest resolves modules through Vite, and Vite
 * does not read tsconfig paths. Until now that never showed, because the only
 * tested modules (orders/totals, orders/promotions, payments/withdrawal-fee,
 * rate-limit) happen to import nothing outside themselves. The first test
 * touching a module that DOES use the alias fails at import with "Cannot find
 * package '@/…'", which reads like a missing dependency rather than a missing
 * resolver.
 *
 * One entry, matching tsconfig, so the two cannot drift.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
