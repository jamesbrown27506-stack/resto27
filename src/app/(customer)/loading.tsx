import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function CustomerLoading() {
  return (
    <div className="container-page py-10">
      <Skeleton className="h-9 w-56" />
      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <Skeleton className="hidden h-96 w-56 shrink-0 lg:block" />
        <div className="grid flex-1 gap-6 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
