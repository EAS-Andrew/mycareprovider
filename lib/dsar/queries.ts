import "server-only";

import { createServerClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DsarRequest = {
  id: string;
  requester_id: string;
  request_type: "access" | "erasure";
  status: "pending" | "processing" | "completed" | "rejected";
  requested_at: string;
  processed_at: string | null;
  download_url: string | null;
  download_expires_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
};

export type ErasureRequest = {
  id: string;
  dsar_request_id: string;
  requester_id: string;
  status:
    | "pending_cooloff"
    | "cooloff_expired"
    | "processing"
    | "completed"
    | "cancelled";
  cooloff_ends_at: string;
  legal_holds: Array<{
    table: string;
    reason: string;
    retention_until: string;
  }>;
  processed_at: string | null;
  created_at: string;
};

export type ErasurePreviewItem = {
  table: string;
  count: number;
  action: "erase" | "retain";
  reason?: string;
};

// ---------------------------------------------------------------------------
// User queries (RLS-scoped)
// ---------------------------------------------------------------------------

export async function getMyDsarRequests(): Promise<DsarRequest[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("dsar_requests")
    .select(
      "id, requester_id, request_type, status, requested_at, processed_at, download_url, download_expires_at, rejection_reason, notes, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as DsarRequest[];
}

export async function getMyErasureRequests(): Promise<ErasureRequest[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("erasure_requests")
    .select(
      "id, dsar_request_id, requester_id, status, cooloff_ends_at, legal_holds, processed_at, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ErasureRequest[];
}

/**
 * Shows the user what will be erased vs retained, with reasons for retention.
 * Uses the user-scoped client so only their own data is visible.
 */
export async function getErasurePreview(
  profileId: string,
): Promise<ErasurePreviewItem[]> {
  const supabase = await createServerClient();
  const items: ErasurePreviewItem[] = [];

  // Tables that will be erased (soft-delete sets deleted_at)
  const erasableTables = [
    { table: "profiles", filter: { id: profileId } },
    { table: "provider_profiles", filter: { id: profileId } },
    { table: "receiver_profiles", filter: { id: profileId } },
    { table: "provider_companies", filter: { id: profileId } },
    { table: "contact_requests", filter: { receiver_id: profileId } },
    { table: "contact_thread_posts", filter: { author_id: profileId } },
    { table: "care_circle_members", filter: { member_id: profileId } },
  ];

  for (const { table, filter } of erasableTables) {
    const [col, val] = Object.entries(filter)[0];
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(col, val);

    if (count && count > 0) {
      items.push({ table, count, action: "erase" });
    }
  }

  // Tables with legal retention holds
  const retainedTables = [
    {
      table: "audit_log",
      reason: "Append-only audit trail - exempt from erasure under UK GDPR Article 17(3)(e)",
    },
    {
      table: "documents",
      reason: "Care and regulatory documents retained per statutory requirements",
    },
    {
      table: "family_authorisations",
      reason: "Legal authority records retained per statutory requirements",
    },
  ];

  for (const { table, reason } of retainedTables) {
    const filterCol =
      table === "audit_log"
        ? "actor_id"
        : table === "family_authorisations"
          ? "family_member_id"
          : "provider_id";

    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(filterCol, profileId);

    if (count && count > 0) {
      items.push({ table, count, action: "retain", reason });
    }
  }

  return items;
}
