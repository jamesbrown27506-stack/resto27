import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-9 w-56" />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="mt-6 rounded-lg border border-border bg-surface">
        <SkeletonTable rows={8} cols={5} />
      </div>
    </div>
  );
}
