"use client";
import { usePathname } from "next/navigation";
const FOCUSED_PREFIXES = ["/checkout", "/cart", "/orders", "/reservations"];
export function CustomerFooter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (FOCUSED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))) return null;
  return children;
}
