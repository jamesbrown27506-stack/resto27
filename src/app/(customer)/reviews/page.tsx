import { ReviewsClient } from "./reviews-client";
import { requireUser } from "@/lib/auth/session";
import { fetchOwnReviews } from "@/lib/data/customer";

export default async function MyReviewsPage() {
  const user = await requireUser();
  const reviews = await fetchOwnReviews(user.id);

  return <ReviewsClient user={user} initial={reviews} />;
}