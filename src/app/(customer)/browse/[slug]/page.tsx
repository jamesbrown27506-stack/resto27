import { permanentRedirect } from "next/navigation";

/**
 * ONE PAGE PER RESTAURANT. THIS IS NOT IT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  WHY THIS ROUTE IS NOW A REDIRECT.
 *
 *  A restaurant used to have two pages. /restaurants/[slug] was the public
 *  one — cover photo, rating, hours, reviews, and a menu you could read but
 *  not order from. /browse/[slug] was the signed-in one — the same menu,
 *  orderable, with almost none of the information you would want before
 *  deciding to order.
 *
 *  So the journey went: see a dish you want → open the restaurant → read
 *  about it → press "Order" → land on a SECOND page of the same restaurant →
 *  find the dish again → add it. The tap that should have added the dish
 *  instead navigated somewhere that looked like where you already were, and
 *  the menu you were looking at was inert the whole time.
 *
 *  There is now one page. /restaurants/[slug] carries the information AND
 *  the orderable menu, so tapping a dish adds a dish. This route stays only
 *  to keep old links, bookmarks and shared URLs working.
 *
 *  PERMANENT, so search engines collapse the duplicate rather than keeping
 *  two entries for one restaurant — the two pages were competing for the
 *  same queries the entire time they both existed.
 * ─────────────────────────────────────────────────────────────────────────
 */
export default async function BrowseRestaurantRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  permanentRedirect(`/restaurants/${slug}`);
}
