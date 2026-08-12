"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Accordion.
 *
 * Two fixes over the PHP version:
 *
 *  1. The trigger is a real <button aria-expanded> rather than a styled div,
 *     so it is keyboard-operable and announces its state.
 *  2. The panel animates with `grid-template-rows: 0fr → 1fr` rather than
 *     `max-height: 200px`. The old approach silently clipped any answer taller
 *     than 200px mid-sentence, and the fix for that is usually to raise the
 *     magic number until it "looks fine" on the current copy.
 */
export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto max-w-3xl">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.question} className="border-b border-border first:border-t">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className={cn(
                  "flex w-full items-center justify-between gap-4 py-5 text-left text-base font-semibold transition-colors",
                  isOpen ? "text-primary" : "hover:text-primary",
                )}
              >
                {item.question}
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-200",
                    isOpen ? "rotate-180 text-primary" : "text-text-light",
                  )}
                  aria-hidden
                />
              </button>
            </h3>

            <div
              id={`faq-panel-${i}`}
              role="region"
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-out",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <p className="pb-5 leading-relaxed text-text-secondary">{item.answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
