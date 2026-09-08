import { beforeEach, expect, it, vi } from "vitest";
import { relationOne } from "@/lib/public-utils";

const db = vi.hoisted(() => ({ reviewRows: [{ rating: 5 }, { rating: 5 }], filters: [] as unknown[][] }));
vi.mock("server-only", () => ({}));
vi.mock("./manager", () => ({ fetchCategories: vi.fn(), fetchMenu: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const result = () => table === "restaurants" ? { data: Array.from({ length: 5 }, () => ({ rating: 0, accepts_delivery: true, delivery_estimate_min: 30 })) }
    : table === "orders" ? { count: 2 } : { data: db.reviewRows };
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => { db.filters.push([table, ...args]); return query; },
    is: (...args: unknown[]) => { db.filters.push([table, ...args]); return query; },
    order: () => query,
    range: () => Promise.resolve(result()),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return query;
} }) }));

beforeEach(() => { db.reviewRows = [{ rating: 5 }, { rating: 5 }]; db.filters = []; });
it("counts actual reviews, not unrated restaurants, in the homepage score", async () => {
  const { fetchPublicStats } = await import("./public");
  const stats = await fetchPublicStats();
  expect(stats).toMatchObject({ restaurantCount: 5, reviewCount: 2, averageRating: 5 });
  expect(db.filters).toContainEqual(["reviews", "removed_at", null]);
  expect(db.filters).toContainEqual(["reviews", "restaurants.status", "active"]);
});
it("gives every submitted review equal weight and handles no reviews", async () => {
  const { fetchPublicStats } = await import("./public");
  db.reviewRows = [{ rating: 5 }, { rating: 5 }, { rating: 2 }];
  expect((await fetchPublicStats()).averageRating).toBe(4);
  db.reviewRows = [];
  expect(await fetchPublicStats()).toMatchObject({ reviewCount: 0, averageRating: 0 });
});
it("reads Supabase relationship objects as well as legacy arrays", () => {
  expect(relationOne({ name: "Bonamoussadi" })?.name).toBe("Bonamoussadi");
  expect(relationOne([{ name: "Cameroonian" }])?.name).toBe("Cameroonian");
  expect(relationOne(null)).toBeUndefined();
});
