"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** The server cannot know; assume motion is fine and let the client correct. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Read the OS "reduce motion" setting.
 *
 * The global CSS rule in globals.css already neutralises transitions and
 * animations. This hook exists for behaviour CSS cannot reach — chiefly
 * stopping the hero from auto-advancing, which is motion the user did not
 * ask for and cannot anticipate.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
