"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ImageUpload } from "@/components/ui/image-upload";
import { useToast } from "@/components/ui/toast";
import { resetAppearanceImage, uploadAppearanceImage } from "./actions";

/**
 * The landing page's photographs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  CHOOSING IS NOT SAVING.
 *
 *  Picking a file only makes a blob: preview; nothing reaches the server or
 *  the homepage until Save. That rule was set after an earlier version of the
 *  branding screen applied a logo the moment it was chosen, which made Discard
 *  a lie. <ImageUpload> owns the picker and the preview and nothing else, so
 *  there is no second copy of the truth to go stale.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The admin area is English by design — same reasoning as ADMIN_NAV. The
 * PUBLIC page these images appear on is fully bilingual; this control room is
 * not.
 */

/** What each slot is for, in the words of someone looking at the live site. */
const COPY: Record<string, { title: string; where: string; hint: string }> = {
  hero_order_image: {
    title: "Hero — “Order”",
    where: "First slide of the homepage carousel",
    hint: "A dish, shot close. Cropped to a circle, so keep the subject centred.",
  },
  hero_book_image: {
    title: "Hero — “Book”",
    where: "Second slide of the carousel",
    hint: "A laid table. Cropped to a circle.",
  },
  hero_explore_image: {
    title: "Hero — “Explore”",
    where: "Third slide of the carousel",
    hint: "The city, or a street scene. Cropped to a circle.",
  },
  home_dishes_image: {
    title: "Popular dishes banner",
    where: "Wide band above the dish grid",
    hint: "Landscape, 1600px or wider. Very short on tall phones — keep it simple.",
  },
  home_kitchen_image: {
    title: "“Kitchen” section",
    where: "Restaurant-owner section, first row",
    hint: "A kitchen in service. Landscape.",
  },
  home_branches_image: {
    title: "“Locations” section",
    where: "Restaurant-owner section, second row",
    hint: "A dining room. Landscape.",
  },
  home_payment_image: {
    title: "“Payment” section",
    where: "Restaurant-owner section, third row",
    hint: "Mobile money, or a phone being used to pay. Landscape.",
  },
};

interface Slot {
  key: string;
  field: string;
  current: string;
  isDefault: boolean;
}

type Pending = { file: File; previewUrl: string };

export function AppearanceForm({ slots }: { slots: Slot[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Record<string, Pending | undefined>>({});
  /** Which slot is mid-request, so only its buttons spin. */
  const [busy, setBusy] = useState<string | null>(null);

  function choose(key: string, file: File) {
    // createObjectURL and revoke both happen HERE rather than inside the
    // updater: React may call an updater twice, and a side effect in one
    // either leaks a URL or frees a live one.
    const previewUrl = URL.createObjectURL(file);
    const previous = chosen[key];
    if (previous) URL.revokeObjectURL(previous.previewUrl);
    setChosen((current) => ({ ...current, [key]: { file, previewUrl } }));
  }

  function discard(key: string) {
    const previous = chosen[key];
    if (previous) URL.revokeObjectURL(previous.previewUrl);
    setChosen((current) => ({ ...current, [key]: undefined }));
  }

  function save(key: string) {
    const choice = chosen[key];
    if (!choice) return;

    setBusy(key);
    startTransition(async () => {
      const body = new FormData();
      body.append("file", choice.file);

      const result = await uploadAppearanceImage(key, body);
      setBusy(null);

      if (!result.ok) return toast(result.error, "error");

      discard(key);
      toast("Image updated. The homepage is already showing it.", "success");
    });
  }

  function reset(key: string) {
    setBusy(key);
    startTransition(async () => {
      const result = await resetAppearanceImage(key);
      setBusy(null);
      if (!result.ok) return toast(result.error, "error");
      discard(key);
      toast("Reset to the image the platform ships with.", "success");
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {slots.map((slot) => {
        const copy = COPY[slot.key];
        const choice = chosen[slot.key];
        const preview = choice?.previewUrl ?? slot.current;
        const working = pending && busy === slot.key;

        return (
          <Card key={slot.key}>
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display font-bold">{copy?.title ?? slot.key}</h2>
                  <p className="mt-0.5 text-sm text-text-secondary">{copy?.where}</p>
                </div>
                {slot.isDefault ? (
                  <Badge tone="neutral">Default</Badge>
                ) : (
                  <Badge tone="success">Custom</Badge>
                )}
              </div>

              {/* The live image, at the shape it actually renders in. A
                  thumbnail that does not match the crop is how someone picks a
                  photo whose subject is cut off on the real page. */}
              <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-border bg-surface-2">
                <Image
                  src={preview}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 40vw, 100vw"
                  className="object-cover"
                  // A blob: URL has no dimensions the optimiser can use, and
                  // an admin preview is not worth a transform either way.
                  unoptimized
                />
              </div>

              <ImageUpload
                label="Replace"
                hint={copy?.hint}
                shape="wide"
                previewUrl={choice?.previewUrl ?? null}
                dirty={Boolean(choice)}
                disabled={working}
                onSelect={(file) => choose(slot.key, file)}
                onUndo={() => discard(slot.key)}
              />

              <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row">
                {!slot.isDefault && (
                  <Button
                    variant="ghost"
                    disabled={working}
                    onClick={() => reset(slot.key)}
                    className="sm:mr-auto"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    <span>Reset to default</span>
                  </Button>
                )}
                <Button loading={working} disabled={!choice} onClick={() => save(slot.key)}>
                  <span>Save this image</span>
                </Button>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
