import { MessageSquare } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { RatingStars } from "@/components/ui/rating-stars";
import { formatDate } from "@/lib/format/datetime";
import { cn } from "@/lib/utils";
import type { RestaurantHours } from "@/lib/data/public";
import type { RestaurantReview as Review } from "@/lib/data/reviews";

const WEEKDAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export function HoursTable({ hours, today }: { hours: RestaurantHours[]; today?: number }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Horaires d&apos;ouverture</caption>
      <tbody className="divide-y divide-border">
        {hours.map((h) => {
          const isToday = today === h.weekday;
          return (
            <tr key={h.weekday} className={cn(isToday && "font-semibold text-primary")}>
              <th scope="row" className="py-2 text-left font-normal">
                {WEEKDAYS[h.weekday]}
                {isToday && <span className="ml-2 text-xs">· aujourd&apos;hui</span>}
              </th>
              <td className="tnum py-2 text-right">
                {h.opensAt && h.closesAt ? `${h.opensAt} – ${h.closesAt}` : "Fermé"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare />}
        title="Pas encore d'avis"
        description="Soyez le premier à donner votre avis après votre commande."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {reviews.map((review) => (
        <li key={review.id} className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-start gap-3">
            <Avatar name={review.customerName} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="font-semibold">{review.customerName}</p>
                <RatingStars value={review.rating} size="sm" />
                <time
                  dateTime={review.createdAt}
                  className="text-xs text-text-light"
                >
                  {formatDate(review.createdAt)}
                </time>
              </div>
              <p className="mt-2 leading-relaxed text-text-secondary">{review.body}</p>

              {review.photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {review.photos.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt="Photo jointe à l'avis"
                      className="size-20 rounded-md border border-border object-cover"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}

              {review.reply && (
                <div className="mt-4 rounded-md border-l-2 border-primary bg-primary-light p-3.5">
                  <p className="text-xs font-bold tracking-wide text-primary uppercase">
                    Réponse du restaurant
                  </p>
                  <p className="mt-1.5 text-sm text-text-secondary">{review.reply}</p>
                </div>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
