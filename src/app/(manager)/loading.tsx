import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function ManagerLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-9 w-64" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="mt-6 rounded-lg border border-border bg-surface">
        <SkeletonTable rows={6} cols={4} />
      </div>
    </div>
  );
}
