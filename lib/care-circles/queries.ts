"use server";

import { createServerClient } from "@/lib/supabase/server";

import type {
  CareCircleMemberRow,
  CareCircleRow,
  FamilyAuthorisationRow,
  FamilyInvitationRow,
} from "./types";

/**
 * C4 care-circle read queries. All reads go through the user-scoped
 * Supabase client so RLS policies are the enforcement boundary.
 */

export async function getCareCircle(): Promise<CareCircleRow | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("care_circles")
    .select("id, receiver_id, name, created_at")
    .eq("receiver_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getCareCircle: ${error.message}`);
  }

  return (data as CareCircleRow | null) ?? null;
}

export async function getCareCircleForMember(): Promise<CareCircleRow | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Find the circle where this user is an active member
  const { data: membership, error: memberError } = await supabase
    .from("care_circle_members")
    .select("circle_id")
    .eq("profile_id", user.id)
    .not("accepted_at", "is", null)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();

  if (memberError || !membership) return null;

  const { data, error } = await supabase
    .from("care_circles")
    .select("id, receiver_id, name, created_at")
    .eq("id", membership.circle_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getCareCircleForMember: ${error.message}`);
  }

  return (data as CareCircleRow | null) ?? null;
}

export async function getCareCircleMembers(
  circleId: string,
): Promise<CareCircleMemberRow[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("care_circle_members")
    .select("id, circle_id, profile_id, role, invited_by, invited_at, accepted_at, removed_at")
    .eq("circle_id", circleId)
    .is("removed_at", null)
    .order("invited_at", { ascending: true });

  if (error) {
    throw new Error(`getCareCircleMembers: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Omit<CareCircleMemberRow, "display_name" | "email">>;

  // Fetch display names for members via the app helper
  const enriched: CareCircleMemberRow[] = [];
  for (const row of rows) {
    // Use the RPC helper to get display name (respects column grants)
    const { data: nameData } = await supabase.rpc("profile_display_name", {
      p_id: row.profile_id,
    });
    enriched.push({
      ...row,
      display_name: (nameData as string) ?? null,
      email: null, // email is not exposed via column grants to other users
    });
  }

  return enriched;
}

export async function getFamilyAuthorisations(
  circleMemberId: string,
): Promise<FamilyAuthorisationRow[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("family_authorisations")
    .select(
      "id, circle_member_id, document_id, authorisation_type, granted_at, expires_at, verified_at, verified_by, notes, created_at",
    )
    .eq("circle_member_id", circleMemberId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`getFamilyAuthorisations: ${error.message}`);
  }

  // Enrich with document info
  const enriched: FamilyAuthorisationRow[] = [];
  for (const row of (data ?? []) as Array<Omit<FamilyAuthorisationRow, "document_title" | "document_status">>) {
    const { data: docData } = await supabase
      .from("documents")
      .select("title, status")
      .eq("id", row.document_id)
      .maybeSingle();

    enriched.push({
      ...row,
      document_title: (docData?.title as string) ?? null,
      document_status: (docData?.status as string) ?? null,
    });
  }

  return enriched;
}

export async function getPendingInvitations(
  circleId: string,
): Promise<FamilyInvitationRow[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("family_invitations")
    .select("id, circle_id, email, role, invited_by, token, expires_at, accepted_at, created_at")
    .eq("circle_id", circleId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`getPendingInvitations: ${error.message}`);
  }

  return (data ?? []) as FamilyInvitationRow[];
}

export async function getInvitationByToken(
  token: string,
): Promise<FamilyInvitationRow | null> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("family_invitations")
    .select("id, circle_id, email, role, invited_by, token, expires_at, accepted_at, created_at")
    .eq("token", token)
    .is("accepted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`getInvitationByToken: ${error.message}`);
  }

  if (!data) return null;

  // Check expiry
  if (new Date(data.expires_at) < new Date()) return null;

  return data as FamilyInvitationRow;
}
