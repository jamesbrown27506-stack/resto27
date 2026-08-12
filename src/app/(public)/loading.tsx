import { SkeletonCard, SkeletonText } from "@/components/ui/skeleton";

export default function PublicLoading() {
  return (
    <div className="container-page py-12">
      <div className="max-w-lg space-y-4">
        <SkeletonText lines={1} className="max-w-[14rem]" />
        <SkeletonText lines={2} />
      </div>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
