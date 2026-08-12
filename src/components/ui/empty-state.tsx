import { cn } from "@/lib/utils";

/**
 * Every list in the app has a zero state, and a blank panel reads as a bug.
 * The `action` slot matters: an empty list is usually a moment where the user
 * needs to be told what to do next, not just that there is nothing here.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      {icon && (
        <span
          className="grid size-14 place-items-center rounded-full bg-primary-light text-primary [&>svg]:size-6"
          aria-hidden
        >
          {icon}
        </span>
      )}
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm leading-relaxed text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
