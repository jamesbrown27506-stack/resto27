import { AccountSidebar } from "./account-sidebar";
import type { SessionUser } from "@/lib/session";

/**
 * Two-column wrapper for the customer's account screens. Opted into by the
 * pages that want it rather than imposed by the route-group layout, so the
 * cart and checkout stay single-column.
 */
export function AccountShell({
  user,
  title,
  description,
  action,
  children,
}: {
  user: SessionUser;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="container-page w-full py-8 lg:py-12">
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
        <AccountSidebar user={user} />

        <main className="min-w-0 flex-1">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl font-bold">{title}</h1>
              {description && <p className="mt-1 text-text-secondary">{description}</p>}
            </div>
            {action}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
