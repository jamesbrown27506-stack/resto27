# Navigation, discovery and restaurant onboarding

The public canonical origin is `https://resto237.online` (`src/lib/seo-config.ts`).
Keep `APP_URL_LIVE` and `NEXT_PUBLIC_SITE_URL` aligned with it in production.
Known www/Vercel aliases redirect permanently to the purchased domain.

Public pages have stable French URLs and English `?lang=en` URLs, with reciprocal
hreflang and canonical tags. The URL sets public-page language independently of
browser language and cookies. Public navigation preserves that language; private
account screens keep the existing saved-language behavior. Restaurant-provided
names and descriptions remain the owner's original content.

## Navigation

- Mobile customers: Home, Explore, Orders, Messages, Account. Sign-in stays visible
  in the header. Protected destinations preserve their destination through login.
- The account screen groups activity and account settings. Restaurant mobile tabs
  prioritize Overview, Orders, Menu (or Kitchen for eligible staff), Messages and
  More. Secondary tools remain filtered by staff capabilities and grouped in More.
- The hero changes mode only when chosen, all three modes fit on mobile, and the
  search appears earlier. Installation prompts wait for engagement and do not cover
  the bottom navigation.

## Search discovery

- `/explore` links to actual neighbourhood, cuisine and food landing pages.
- `/restaurants/[slug]/menu/[dishId]` exposes individual dishes and ordering using
  the existing basket/modifier flow. Hidden categories and inactive restaurants
  are excluded from discovery. No artificial city pages or invented reviews exist.
- The sitemap is generated on request from current public catalogue data, including
  both public language variants. Account/auth areas are marked noindex.
- Restaurant structured data includes real addresses, contact information, hours,
  menu links, images and eligible ratings. Dish pages include MenuItem/Offer and
  breadcrumb data. Missing coordinates are not invented.
- The homepage average uses all non-removed reviews for active restaurants, with
  equal weight per review; unrated restaurants no longer count as zero reviews.

## First-login dishes

The existing first-login selection now offers Foléré / jus de bissap, BHB, rice
and stew, and jollof / fried rice. The four supplied JFIF files were decoded and
encoded as JPEG under `public/default`. The Foléré template uses the drinks
category. Existing setup price controls and duplicate prevention remain in place;
existing restaurant menus are not overwritten. Templates use the existing default
price until the owner edits it; owners should adapt names, recipes and prices.

## Google launch steps requiring account access

1. Verify the `resto237.online` Domain property in Google Search Console using its
   DNS TXT record. Alternatively, URL-prefix verification can use the optional
   `GOOGLE_SITE_VERIFICATION` environment variable and a redeploy.
2. Submit `https://resto237.online/sitemap.xml` and inspect a homepage, restaurant,
   dish and discovery URL. Monitor indexing, Core Web Vitals and search queries.
3. Restaurant owners should complete their factual descriptions, street addresses,
   hours, photographs, cuisine and neighbourhood fields. Their eligible Google
   Business Profiles can link to the specific Resto237 restaurant/menu page.
4. Google decides indexing, rich results and ranking. Publishing structured data
   does not create a Maps listing or guarantee ranking for “near me.”
