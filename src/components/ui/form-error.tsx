"use client";

import { useEffect, useRef } from "react";
import { XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Why a form was refused — shown IN the form, where the person is looking.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  A toast is the wrong place for a form's refusal. The forms that matter
 *  most (the withdrawal PIN, a payout number, a branch) live in modal
 *  dialogs, and a modal <dialog> sits in the browser's top layer with a
 *  blurred backdrop over everything else: the toast saying "wrong password"
 *  appeared BEHIND that blur, unreadable, and the form seemed to ignore the
 *  click. The reason belongs next to the fields that caused it.
 *
 *  role="alert" so a screen reader announces it the moment it appears;
 *  scrolled into view, because a long form may have been scrolled past its
 *  top when the answer came back.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function FormError({ message, className }: { message?: string | null; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [message]);

  if (!message) return null;

  return (
    <p
      ref={ref}
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-error/30 bg-error-light p-3 text-sm font-medium text-error",
        className,
      )}
    >
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}
