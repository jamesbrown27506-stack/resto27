import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTableLanding } from "@/lib/data/dining-actions";
import { GuestTableClient } from "./guest-table-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Table service", robots: { index: false, follow: false } };
export default async function GuestTablePage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;const landing=await getTableLanding(token);if(!landing)notFound();
  return <GuestTableClient landing={landing}/>;
}
