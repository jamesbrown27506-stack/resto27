import type { Metadata } from "next";
import { ManagerPage } from "@/components/layout/manager-shell";
import { ReviewsView } from "./reviews-view";
import { requireCapability } from "@/lib/auth/branch";
import { fetchReviews, reviewSummary } from "@/lib/data/reviews";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale-server";

/** The browser tab is a user-visible string too, so it follows the locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: DICTIONARIES[locale]["mrv.title"] };
}

// A customer can post a review at any moment, and a reply must be visible the
// instant it is published. Caching this page would show a stale conversation.
export const dynamic = "force-dynamic";

export default async function ManagerReviewsPage() {
  const { active } = await requireCapability("reviews.reply");
  const reviews = await fetchReviews(active.restaurantId);

  return (
    <ManagerPage titleKey="mrv.title" descriptionKey="mrv.subtitle">
      {/* Folded once here rather than on every client render. */}
      <ReviewsView reviews={reviews} summary={reviewSummary(reviews)} />
    </ManagerPage>
  );
}
