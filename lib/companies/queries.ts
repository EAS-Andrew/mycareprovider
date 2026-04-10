"use server";

import { createServerClient } from "@/lib/supabase/server";

import type { CompanyMemberRow, CompanyProfileRow } from "./types";

export async function getCompanyProfile(): Promise<CompanyProfileRow | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("provider_companies")
    .select(
      "id, company_name, company_number, registered_address, service_postcode, latitude, longitude, geocoded_at, description, website, phone, verified_at, created_at, updated_at, deleted_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`getCompanyProfile: ${error.message}`);
  }

  return (data as CompanyProfileRow | null) ?? null;
}

export async function getCompanyMembers(): Promise<CompanyMemberRow[]> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("company_memberships")
    .select("id, company_id, provider_id, role, invited_by, invited_at, accepted_at, removed_at")
    .eq("company_id", user.id)
    .is("removed_at", null)
    .order("invited_at", { ascending: true });

  if (error) {
    throw new Error(`getCompanyMembers: ${error.message}`);
  }

  // Resolve display names via the app.profile_display_name helper.
  const rows = (data ?? []) as Array<Omit<CompanyMemberRow, "provider_display_name">>;
  const result: CompanyMemberRow[] = [];
  for (const row of rows) {
    const { data: nameData } = await supabase.rpc("profile_display_name", {
      p_id: row.provider_id,
    });
    result.push({
      ...row,
      provider_display_name: (nameData as string | null) ?? null,
    });
  }

  return result;
}

export async function getCompanyDocuments() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, kind, title, description, mime_type, size_bytes, status, rejected_reason, expires_at, created_at, verifications ( state, notes, reviewed_at )",
    )
    .eq("provider_company_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`getCompanyDocuments: ${error.message}`);
  }

  type ListDocumentsRow = {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    mime_type: string;
    size_bytes: number;
    status: string;
    rejected_reason: string | null;
    expires_at: string | null;
    created_at: string;
    verifications:
      | { state: string; notes: string | null; reviewed_at: string | null }
      | Array<{ state: string; notes: string | null; reviewed_at: string | null }>
      | null;
  };

  const rows = (data ?? []) as ListDocumentsRow[];

  return rows.map((row) => {
    const verification = Array.isArray(row.verifications)
      ? (row.verifications[0] ?? null)
      : row.verifications;
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      status: row.status as "quarantined" | "available" | "rejected",
      rejected_reason: row.rejected_reason,
      expires_at: row.expires_at,
      created_at: row.created_at,
      verification_state:
        (verification?.state as
          | "pending"
          | "in_review"
          | "approved"
          | "rejected"
          | null) ?? null,
      verification_notes: verification?.notes ?? null,
      verification_reviewed_at: verification?.reviewed_at ?? null,
    };
  });
}
