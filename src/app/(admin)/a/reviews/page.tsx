import { AdminPage } from "@/components/layout/admin-shell";
import { ReviewsModeration } from "./reviews-moderation";
import { listReportedReviews } from "@/lib/data/platform";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const reviews = await listReportedReviews();

  return (
    <AdminPage
      title="Reported reviews"
      description="Reviews flagged by restaurants, awaiting a decision."
    >
      <ReviewsModeration reviews={reviews} />
    </AdminPage>
  );
}
