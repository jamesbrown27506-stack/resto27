import { HandHeart, Heart, ThumbsUp, type LucideIcon } from "lucide-react";
import type { ReviewReaction } from "@/lib/reviews/attention";
import { cn } from "@/lib/utils";

/**
 * A restaurant's reaction to a review, drawn as a Lucide icon — never an
 * emoji. Emojis render differently on every phone and made the reviews look
 * improvised; icons follow the palette and read as one product.
 */
const ICONS: Record<ReviewReaction, LucideIcon> = {
  heart: Heart,
  thanks: HandHeart,
  like: ThumbsUp,
};

export function ReactionIcon({
  reaction,
  className,
  filled = false,
}: {
  reaction: ReviewReaction;
  className?: string;
  /** Solid heart when chosen; the other two stay outlined. */
  filled?: boolean;
}) {
  const Icon = ICONS[reaction];
  return (
    <Icon
      aria-hidden
      className={cn("size-4", className)}
      fill={filled && reaction === "heart" ? "currentColor" : "none"}
    />
  );
}
