import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Collects all personal data for a given profile into a structured JSON bundle.
 * Uses the admin client to read across tables regardless of RLS.
 *
 * The export covers every regulated table where the user is the subject.
 * Document file contents are NOT included - only metadata. The audit_log
 * entries where the user is the actor are included for transparency.
 */
export async function generateDataExport(
  profileId: string,
): Promise<Record<string, unknown>> {
  const admin = createAdminClient();

  const [
    profile,
    providerProfile,
    providerCompany,
    companyMemberships,
    receiverProfile,
    careCircles,
    careCircleMembers,
    familyAuthorisations,
    documents,
    contactRequestsSent,
    contactRequestsReceived,
    contactThreads,
    contactThreadPosts,
    auditLogEntries,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, email, role, created_at, updated_at")
      .eq("id", profileId)
      .maybeSingle()
      .then((r) => r.data),

    admin
      .from("provider_profiles")
      .select(
        "id, headline, bio, city, postcode, years_experience, hourly_rate_pence, verified_at, created_at, updated_at",
      )
      .eq("id", profileId)
      .is("deleted_at", null)
      .maybeSingle()
      .then((r) => r.data),

    admin
      .from("provider_companies")
      .select(
        "id, company_name, company_number, registered_address, service_postcode, description, website, phone, verified_at, created_at, updated_at",
      )
      .eq("id", profileId)
      .is("deleted_at", null)
      .maybeSingle()
      .then((r) => r.data),

    admin
      .from("company_memberships")
      .select("company_id, role, accepted_at, created_at")
      .eq("member_id", profileId)
      .is("deleted_at", null)
      .then((r) => r.data ?? []),

    admin
      .from("receiver_profiles")
      .select("id, created_at, updated_at")
      .eq("id", profileId)
      .is("deleted_at", null)
      .maybeSingle()
      .then((r) => r.data),

    admin
      .from("care_circles")
      .select("id, receiver_id, created_at")
      .eq("receiver_id", profileId)
      .is("deleted_at", null)
      .then((r) => r.data ?? []),

    admin
      .from("care_circle_members")
      .select("care_circle_id, member_id, role, accepted_at, created_at")
      .eq("member_id", profileId)
      .is("deleted_at", null)
      .then((r) => r.data ?? []),

    admin
      .from("family_authorisations")
      .select(
        "id, authorisation_type, granted_at, expires_at, verified_at, created_at",
      )
      .eq("family_member_id", profileId)
      .is("deleted_at", null)
      .then((r) => r.data ?? []),

    admin
      .from("documents")
      .select(
        "id, kind, title, description, status, mime_type, size_bytes, expires_at, created_at",
      )
      .or(
        `provider_id.eq.${profileId},provider_company_id.eq.${profileId},receiver_id.eq.${profileId}`,
      )
      .is("deleted_at", null)
      .then((r) => r.data ?? []),

    admin
      .from("contact_requests")
      .select(
        "id, provider_id, subject, body, status, responded_at, created_at",
      )
      .eq("receiver_id", profileId)
      .is("deleted_at", null)
      .then((r) => r.data ?? []),

    admin
      .from("contact_requests")
      .select(
        "id, receiver_id, subject, body, status, responded_at, response_note, created_at",
      )
      .eq("provider_id", profileId)
      .is("deleted_at", null)
      .then((r) => r.data ?? []),

    admin
      .from("contact_threads")
      .select("id, contact_request_id, created_at")
      .or(
        `contact_request_id.in.(${[
          ...(
            await admin
              .from("contact_requests")
              .select("id")
              .or(
                `receiver_id.eq.${profileId},provider_id.eq.${profileId}`,
              )
              .is("deleted_at", null)
          ).data?.map((r: { id: string }) => r.id) ?? [],
        ].join(",")})`,
      )
      .then((r) => r.data ?? []),

    admin
      .from("contact_thread_posts")
      .select("id, thread_id, author_id, body, created_at")
      .eq("author_id", profileId)
      .then((r) => r.data ?? []),

    admin
      .from("audit_log")
      .select("id, action, subject_table, subject_id, created_at")
      .eq("actor_id", profileId)
      .order("created_at", { ascending: false })
      .limit(500)
      .then((r) => r.data ?? []),
  ]);

  return {
    exported_at: new Date().toISOString(),
    subject_id: profileId,
    profile,
    provider_profile: providerProfile,
    provider_company: providerCompany,
    company_memberships: companyMemberships,
    receiver_profile: receiverProfile,
    care_circles: careCircles,
    care_circle_members: careCircleMembers,
    family_authorisations: familyAuthorisations,
    documents_metadata: documents,
    contact_requests_sent: contactRequestsSent,
    contact_requests_received: contactRequestsReceived,
    contact_threads: contactThreads,
    contact_thread_posts: contactThreadPosts,
    audit_log_entries: auditLogEntries,
  };
}
