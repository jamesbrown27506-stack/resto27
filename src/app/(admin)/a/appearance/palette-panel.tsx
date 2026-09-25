"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setColorPalette } from "./actions";
import type { ColorPalette } from "@/lib/branding";

/**
 * Two palettes, shown as their real colours (not CSS variables — the admin
 * must see both side by side whatever is active now).
 */
const PALETTES: {
  id: ColorPalette;
  name: string;
  description: string;
  swatches: { label: string; hex: string }[];
}[] = [
  {
    id: "classic",
    name: "Classic — sage",
    description: "The original look: calm sage green on warm cream, copper accent.",
    swatches: [
      { label: "Buttons", hex: "#5f7257" },
      { label: "Accent", hex: "#9a6234" },
      { label: "Brand", hex: "#33462f" },
      { label: "Background", hex: "#f7f4ed" },
    ],
  },
  {
    id: "ndole",
    name: "Ndolé — appetite",
    description:
      "Chilli-orange buttons and links (the colour food apps use to make ordering feel warm and urgent), deep Cameroonian green for the brand, every text colour readable (AA).",
    swatches: [
      { label: "Buttons", hex: "#c2410c" },
      { label: "Accent", hex: "#1f6b4a" },
      { label: "Brand", hex: "#1f4d3a" },
      { label: "Background", hex: "#faf6f0" },
    ],
  },
];

export function PalettePanel({ current }: { current: ColorPalette }) {
  const { toast } = useToast();
  const [active, setActive] = useState(current);
  const [pending, startTransition] = useTransition();

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">Colour palette</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Applies to the whole site — customers, restaurants and admin — in light and dark mode. Switch back at any time.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {PALETTES.map((palette) => {
          const isActive = active === palette.id;
          return (
            <div
              key={palette.id}
              className={`rounded-lg border-2 p-4 ${isActive ? "border-primary" : "border-border"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{palette.name}</p>
                {isActive && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
                    <Check className="size-3.5" aria-hidden /> Active
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                {palette.swatches.map((swatch) => (
                  <div key={swatch.label} className="flex flex-col items-center gap-1">
                    <span
                      className="size-10 rounded-md border border-border"
                      style={{ backgroundColor: swatch.hex }}
                      aria-hidden
                    />
                    <span className="text-[10px] text-text-light">{swatch.label}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-text-secondary">{palette.description}</p>
              <Button
                size="sm"
                variant={isActive ? "outline" : "primary"}
                className="mt-3"
                disabled={isActive || pending}
                loading={pending && !isActive}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setColorPalette(palette.id);
                    if (!result.ok) return toast(result.error, "error");
                    setActive(palette.id);
                    toast(`${palette.name} is now live. Reload to see it here.`, "success");
                  })
                }
              >
                {isActive ? "In use" : "Use this palette"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
