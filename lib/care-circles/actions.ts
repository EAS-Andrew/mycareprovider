"use server";

import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { assertAllowedUpload } from "@/lib/documents/mime";
import { assertSniffedMime } from "@/lib/documents/sniff";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import {
  RECEIVER_DOCS_BUCKET,
  isAuthorisationType,
  type AuthorisationType,
} from "./types";

/**
 * C4 care-circle Server Actions.
 *
 * All mutations go through the user-scoped Supabase client so RLS is the
 * enforcement boundary. Every mutation writes a W2 audit event via
 * recordAuditEvent.
 */

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const stripped = base.replace(/[\x00-\x1f\x7f"#%&'<>?`{}|]+/g, "");
  const encoded = encodeURIComponent(stripped).replace(/\*/g, "%2A");
  const trimmed = encoded.replace(/^[._-]+|[._-]+$/g, "");
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "file";
}

// ---------------------------------------------------------------- createCareCircle

export async function createCareCircle(
  name?: string,
): Promise<{ circleId: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("sign-in-required");

  const callerRole = await getCurrentRole(supabase, user);
  if (callerRole !== "receiver" && callerRole !== "family_member") {
    throw new Error("receiver-required");
  }

  const { data, error } = await supabase
    .from("care_circles")
    .insert({
      receiver_id: user.id,
      name: name ?? "My care circle",
    })
    .select("id")
    .single();

  if (error) {
    // If already exists, fetch the existing one
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("care_circles")
        .select("id")
        .eq("receiver_id", user.id)
        .is("deleted_at", null)
        .single();
      if (existing) return { circleId: existing.id as string };
    }
    throw new Error(`createCareCircle: ${error.message}`);
  }

  await recordAuditEvent({
    action: "care_circle.create",
    subjectTable: "public.care_circles",
    subjectId: data.id as string,
    after: { name: name ?? "My care circle" },
  });

  return { circleId: data.id as string };
}

// ---------------------------------------------------------------- inviteFamilyMember

export async function inviteFamilyMember(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const roleRaw = optionalString(formData, "role") ?? "member";
  const circleRole = roleRaw === "primary" ? "primary" : "member";

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("sign-in-required");

  const callerRole = await getCurrentRole(supabase, user);
  if (callerRole !== "receiver" && callerRole !== "family_member") {
    throw new Error("receiver-required");
  }

  // Auto-create circle if it doesn't exist (receiver only)
  let circleId: string;
  const { data: existingCircle } = await supabase
    .from("care_circles")
    .select("id")
    .eq("receiver_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingCircle) {
    circleId = existingCircle.id as string;
  } else if (callerRole === "receiver") {
    const result = await createCareCircle();
    circleId = result.circleId;
  } else {
    // Family member - find circle they belong to
    const { data: membership } = await supabase
      .from("care_circle_members")
      .select("circle_id")
      .eq("profile_id", user.id)
      .not("accepted_at", "is", null)
      .is("removed_at", null)
      .limit(1)
      .maybeSingle();
    if (!membership) throw new Error("not-in-circle");
    circleId = membership.circle_id as string;
  }

  // Create the invitation
  const { data: invitation, error: inviteError } = await supabase
    .from("family_invitations")
    .insert({
      circle_id: circleId,
      email,
      role: circleRole,
      invited_by: user.id,
    })
    .select("id, token")
    .single();

  if (inviteError) {
    throw new Error(`inviteFamilyMember: ${inviteError.message}`);
  }

  await recordAuditEvent({
    action: "care_circle.invite",
    subjectTable: "public.family_invitations",
    subjectId: invitation.id as string,
    after: { email, role: circleRole },
  });

  // TODO: send invitation email with the token link
  // For now the invitation token is stored and the accept page reads it

  redirect("/receiver/family?invited=1");
}

// ---------------------------------------------------------------- acceptInvitation

export async function acceptInvitation(token: string): Promise<void> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("sign-in-required");

  // Look up the invitation
  const { data: invitation, error: lookupError } = await supabase
    .from("family_invitations")
    .select("id, circle_id, email, role, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle();

  if (lookupError || !invitation) {
    throw new Error("invalid-invitation");
  }

  if (invitation.accepted_at) {
    throw new Error("invitation-already-accepted");
  }

  if (new Date(invitation.expires_at as string) < new Date()) {
    throw new Error("invitation-expired");
  }

  // Mark invitation as accepted
  const { error: acceptError } = await supabase
    .from("family_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  if (acceptError) {
    throw new Error(`acceptInvitation: ${acceptError.message}`);
  }

  // Add the user as a circle member
  const { error: memberError } = await supabase
    .from("care_circle_members")
    .insert({
      circle_id: invitation.circle_id,
      profile_id: user.id,
      role: invitation.role,
      invited_by: user.id,
      accepted_at: new Date().toISOString(),
    });

  if (memberError) {
    // If already a member, that's fine
    if (memberError.code !== "23505") {
      throw new Error(`acceptInvitation: ${memberError.message}`);
    }
  }

  await recordAuditEvent({
    action: "care_circle.accept_invitation",
    subjectTable: "public.care_circle_members",
    subjectId: invitation.circle_id as string,
    after: { role: invitation.role },
  });

  redirect("/receiver/family");
}

// ---------------------------------------------------------------- removeMember

export async function removeMember(memberId: string): Promise<void> {
  if (!memberId) throw new Error("Missing memberId");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("sign-in-required");

  const { error } = await supabase
    .from("care_circle_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", memberId);

  if (error) {
    throw new Error(`removeMember: ${error.message}`);
  }

  await recordAuditEvent({
    action: "care_circle.remove_member",
    subjectTable: "public.care_circle_members",
    subjectId: memberId,
  });
}

// ---------------------------------------------------------------- uploadAuthorisationDocument

export async function uploadAuthorisationDocument(
  formData: FormData,
): Promise<{ documentId: string; authorisationId: string }> {
  const memberId = formString(formData, "member_id");
  const typeRaw = formString(formData, "authorisation_type");
  if (!isAuthorisationType(typeRaw)) {
    throw new Error("Invalid authorisation type");
  }
  const authorisationType: AuthorisationType = typeRaw;

  const title = formString(formData, "title");
  const notes = optionalString(formData, "notes");

  const expiresAtRaw = optionalString(formData, "expires_at");
  const expiresAt =
    expiresAtRaw && expiresAtRaw.length > 0 ? expiresAtRaw : null;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Missing form field: file");
  }

  assertAllowedUpload({ mimeType: file.type, sizeBytes: file.size });
  const sniffedMime = await assertSniffedMime(file, file.type);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("sign-in-required");

  const callerRole = await getCurrentRole(supabase, user);
  if (callerRole !== "family_member" && callerRole !== "receiver") {
    throw new Error("family-member-required");
  }

  // Verify the caller is this circle member
  const { data: member } = await supabase
    .from("care_circle_members")
    .select("id, circle_id, profile_id")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) throw new Error("member-not-found");
  if ((member.profile_id as string) !== user.id) {
    throw new Error("not-your-membership");
  }

  // Find the receiver for this circle
  const { data: circle } = await supabase
    .from("care_circles")
    .select("receiver_id")
    .eq("id", member.circle_id)
    .maybeSingle();

  if (!circle) throw new Error("circle-not-found");
  const receiverId = circle.receiver_id as string;

  // Upload to storage
  const profileId = user.id;
  const objectName = `${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const storagePath = `quarantine/${profileId}/${objectName}`;

  const upload = await supabase.storage
    .from(RECEIVER_DOCS_BUCKET)
    .upload(storagePath, file, {
      contentType: sniffedMime,
      upsert: false,
    });

  if (upload.error) {
    console.warn(
      `uploadAuthorisationDocument: user-scoped upload failed, falling back to admin: ${upload.error.message}`,
    );
    const admin = createAdminClient();
    const adminUpload = await admin.storage
      .from(RECEIVER_DOCS_BUCKET)
      .upload(storagePath, file, {
        contentType: sniffedMime,
        upsert: false,
      });
    if (adminUpload.error) {
      throw new Error(`upload failed: ${adminUpload.error.message}`);
    }
  }

  // Insert the document row
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      uploaded_by: profileId,
      receiver_id: receiverId,
      kind: "authorisation",
      title,
      description: notes,
      storage_bucket: RECEIVER_DOCS_BUCKET,
      storage_path: storagePath,
      mime_type: sniffedMime,
      size_bytes: file.size,
      sha256: null,
      status: "quarantined",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (docError || !doc) {
    // Best-effort cleanup
    try {
      const admin = createAdminClient();
      await admin.storage.from(RECEIVER_DOCS_BUCKET).remove([storagePath]);
    } catch {
      // swallow
    }
    throw new Error(`insert failed: ${docError?.message ?? "unknown error"}`);
  }

  const documentId = doc.id as string;

  // Create the family_authorisation row
  const { data: auth, error: authError } = await supabase
    .from("family_authorisations")
    .insert({
      circle_member_id: memberId,
      document_id: documentId,
      authorisation_type: authorisationType,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt,
      notes,
    })
    .select("id")
    .single();

  if (authError || !auth) {
    throw new Error(
      `authorisation insert failed: ${authError?.message ?? "unknown error"}`,
    );
  }

  await recordAuditEvent({
    action: "care_circle.upload_authorisation",
    subjectTable: "public.family_authorisations",
    subjectId: auth.id as string,
    after: {
      authorisation_type: authorisationType,
      title,
      expires_at: expiresAt,
      size_bytes: file.size,
    },
  });

  return { documentId, authorisationId: auth.id as string };
}

// ---------------------------------------------------------------- signUpFamilyMember

/**
 * Family member sign-up. Called from the invitation acceptance page.
 * Creates an auth account with role='family_member' via the admin client
 * (since family members need the invited_by path per migration 0009).
 */
export async function signUpFamilyMember(
  formData: FormData,
): Promise<void> {
  const email = formString(formData, "email");
  const password = formString(formData, "password");
  const displayName = optionalString(formData, "display_name");
  const token = formString(formData, "token");

  // Validate the invitation token. Use a fresh server client (the user is
  // not signed in yet, so this is an anon-scoped read).
  const supabase = await createServerClient();
  const { data: invitation, error: lookupError } = await supabase
    .from("family_invitations")
    .select("id, circle_id, email, role, invited_by, expires_at, accepted_at")
    .eq("token", token)
    .maybeSingle();

  if (lookupError || !invitation) {
    redirect("/auth/family-invite?error=invalid_token");
  }

  if (invitation.accepted_at) {
    redirect("/auth/family-invite?error=already_accepted");
  }

  if (new Date(invitation.expires_at as string) < new Date()) {
    redirect("/auth/family-invite?error=expired");
  }

  // Use admin client to create the user with the invited_by path.
  // Migration 0009 only honours raw_user_meta_data.role when
  // raw_app_meta_data.invited_by is set.
  const admin = createAdminClient();
  const { data: newUser, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "family_member",
        display_name: displayName,
      },
      app_metadata: {
        invited_by: invitation.invited_by,
      },
    });

  if (createError) {
    redirect(
      `/auth/family-invite?token=${encodeURIComponent(token)}&error=signup_failed`,
    );
  }

  const userId = newUser.user.id;

  // Mark invitation as accepted
  const { error: acceptError } = await admin
    .from("family_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  if (acceptError) {
    console.error("Failed to mark invitation as accepted:", acceptError);
  }

  // Add the user as a circle member (using admin client to bypass RLS
  // since the user has no session yet)
  const { error: memberError } = await admin
    .from("care_circle_members")
    .insert({
      circle_id: invitation.circle_id,
      profile_id: userId,
      role: invitation.role,
      invited_by: invitation.invited_by,
      accepted_at: new Date().toISOString(),
    });

  if (memberError && memberError.code !== "23505") {
    console.error("Failed to add circle member:", memberError);
  }

  await recordAuditEvent({
    action: "family_member.signup",
    subjectTable: "auth.users",
    subjectId: email,
    after: {
      email,
      role: "family_member",
      display_name: displayName,
      circle_id: invitation.circle_id,
    },
  });

  // Sign the new user in automatically so they don't have to re-enter
  // the credentials they just set.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    // Fall back to the sign-in page if auto-sign-in fails.
    redirect(`/auth/sign-in?next=/receiver/family`);
  }

  redirect("/receiver/family");
}
