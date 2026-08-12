"use client";

import { Moon, Sun } from "lucide-react";
import { toggleTheme } from "./theme-provider";
import { cn } from "@/lib/utils";

/**
 * Light / dark switch.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  EVERY VISUAL STATE IS CSS, NOT JAVASCRIPT.
 *
 *  The old version branched on a `theme` value read from localStorage, which
 *  the server cannot see: a dark-mode visitor got a Moon on the client and a
 *  Sun in the HTML, and React reported a hydration mismatch on every page
 *  carrying the toggle.
 *
 *  Now the markup is identical whatever the theme, and the `dark:` variant
 *  (defined in globals.css against [data-theme]) picks which half is visible.
 *  The correct icon therefore shows on the very first paint — before React
 *  has even hydrated — and there is nothing left for a mismatch to be about.
 *
 *  The screen-reader label follows the same trick. `hidden` is display:none,
 *  which assistive technology honours, so exactly one sentence is announced
 *  and it is always the true one.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title="Light / dark"
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-border bg-surface-2 transition-colors dark:bg-primary/25",
        className,
      )}
    >
      <span className="sr-only">
        <span className="dark:hidden">Light theme active. Switch to dark.</span>
        <span className="hidden dark:inline">Dark theme active. Switch to light.</span>
      </span>

      <span className="grid size-5 translate-x-1 place-items-center rounded-full bg-surface text-accent-hover shadow-sm transition-transform duration-200 dark:translate-x-6 dark:bg-primary dark:text-primary-fg">
        <Sun className="size-3 dark:hidden" aria-hidden />
        <Moon className="hidden size-3 dark:block" aria-hidden />
      </span>
    </button>
  );
}
