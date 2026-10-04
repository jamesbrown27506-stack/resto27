import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The audit trail writer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  DELIBERATELY NOT IN A "use server" FILE.
 *
 *  It lived in lib/data/platform-actions.ts, a "use server" module — and
 *  every export of such a module is a public POST endpoint. `writeAudit`
 *  takes its ACTOR as an argument, so anyone could post rows to the audit
 *  log in an administrator's name: forged history, in the one table whose
 *  job is to be believed. A plain server-only module is callable by the
 *  actions and routes that record what they did, and by nothing else.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
  impersonatorEmail?: string | null;
}

/**
 * Write one audit row.
 *
 * TWO RULES, BOTH FROM §9:
 *
 *  1. The actor's email and role are SNAPSHOTTED onto the row, never joined.
 *     Actors get anonymised; the trail has to survive them. A join to profiles
 *     would render "Compte supprimé" against every historical action.
 *
 *  2. THIS NEVER THROWS. A failure to write history must not break the
 *     operation being recorded. Suspending a fraudulent account must succeed
 *     even if the audit table is full, locked or missing.
 */
export async function writeAudit(
  actor: { id: string; email: string; role: string },
  input: AuditInput,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    // Outside a request (a script) there are no headers; the row is still written.
    const headerList = await headers().catch(() => null);

    await supabase.from("audit_log").insert({
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      actor_profile_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      impersonator_email: input.impersonatorEmail ?? null,
      summary: input.summary ?? "",
      metadata: input.metadata ?? null,
      ip_address:
        headerList?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headerList?.get("x-real-ip") ??
        null,
      user_agent: headerList?.get("user-agent") ?? null,
    });
  } catch (error) {
    console.error("[audit] write failed — operation continues regardless", error);
  }
}
