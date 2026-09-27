import { MessageSquareText, Star } from "lucide-react";
import { AdminPage } from "@/components/layout/admin-shell";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type FeedbackRow = {
  id: string;
  source: "dining" | "reservation" | "order" | "other";
  rating: number | null;
  body: string;
  created_at: string;
  restaurants: { name: string } | { name: string }[] | null;
  profiles: { name: string } | { name: string }[] | null;
};

const SOURCE: Record<FeedbackRow["source"], string> = {
  dining: "Table visit (QR)",
  reservation: "After a booking",
  order: "After an order",
  other: "Other",
};

/**
 * "How do you find Resto237? What can we improve?" (0068).
 *
 * Optional answers left after a table visit or a booking. Read by the
 * platform team only — restaurants never see this, which is what lets
 * guests be candid about the app itself.
 */
export default async function PlatformFeedbackPage() {
  await requireRole("admin");
  const { data, error } = await createAdminClient()
    .from("platform_feedback")
    .select("id, source, rating, body, created_at, restaurants ( name ), profiles ( name )")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as FeedbackRow[];
  const rated = rows.filter((row) => row.rating);
  const average = rated.length ? rated.reduce((sum, row) => sum + (row.rating ?? 0), 0) / rated.length : null;
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v) ?? null;

  return (
    <AdminPage title="Platform feedback" description="What guests say about Resto237 itself — optional, after a table visit or a booking. Never shown to restaurants.">
      {error ? (
        <p className="rounded-lg border border-warning/30 bg-warning-light p-4 text-sm text-warning">
          Run migration 0068 in the Supabase SQL editor to collect platform feedback.
        </p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-text-secondary">Answers (latest 200)</p>
              <p className="tnum font-display text-2xl font-bold">{rows.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-text-secondary">Average rating</p>
              <p className="tnum flex items-center gap-1 font-display text-2xl font-bold">
                {average ? average.toFixed(1) : "—"}<Star className="size-5 fill-warning text-warning" aria-hidden />
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-text-secondary">With a written comment</p>
              <p className="tnum font-display text-2xl font-bold">{rows.filter((row) => row.body && row.body !== "—").length}</p>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-secondary">No feedback yet.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {rows.map((row) => (
                <li key={row.id} className="flex gap-3 p-4">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0 text-text-light" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                      <span className="font-semibold">{SOURCE[row.source] ?? row.source}</span>
                      {one(row.restaurants)?.name && <span>at {one(row.restaurants)?.name}</span>}
                      {one(row.profiles)?.name && <span>by {one(row.profiles)?.name}</span>}
                      <time dateTime={row.created_at}>
                        {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Douala", dateStyle: "medium", timeStyle: "short" }).format(new Date(row.created_at))}
                      </time>
                      {row.rating && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-warning">
                          {row.rating}<Star className="size-3 fill-warning" aria-hidden />
                        </span>
                      )}
                    </p>
                    {row.body && row.body !== "—" && <p className="mt-1 text-sm whitespace-pre-line break-words">{row.body}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AdminPage>
  );
}
