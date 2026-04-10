"use server";

import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { classifyAuthError } from "@/lib/auth/classify-error";
import { getCurrentRole, type AppRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  provider: "/provider",
  provider_company: "/provider",
  receiver: "/receiver",
  family_member: "/receiver",
};

function homeForRole(role: AppRole | null | undefined): string {
  if (role && role in ROLE_HOME) {
    return ROLE_HOME[role];
  }
  return "/";
}


/**
 * Safe predicate for the `?next=` redirect target. Must start with a single
 * forward slash followed by a non-slash, non-backslash character - this
 * rejects `//evil.com/path` and `/\evil.com/path` which browsers resolve as
 * protocol-relative navigations. See finding auth#3.
 */
function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\/[^/\\]/.test(value) ? value : null;
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing form field: ${key}`);
  }
  return value;
}

export async function signIn(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const password = formString(formData, "password");
  const next = safeNext(formData.get("next") as string | null);

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const code = classifyAuthError(error.message);
    const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";
    redirect(`/auth/sign-in?error=${code}${nextParam}`);
  }

  // Role comes exclusively from profiles.role (finding auth#2).
  const role = await getCurrentRole(supabase);

  redirect(next ?? homeForRole(role));
}

export async function signUp(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const password = formString(formData, "password");
  const displayName = (formData.get("display_name") as string | null) ?? null;

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // NOTE: We deliberately do NOT pass `role` in metadata. The
      // `handle_new_auth_user` trigger in migration 0001 historically trusted
      // `raw_user_meta_data.role` (finding auth#1); sql-fixer is hardening
      // that in migration 0009. Keeping role out of metadata here defends in
      // depth even if the trigger fix regresses.
      data: {
        display_name: displayName,
      },
    },
  });

  if (error) {
    const code = classifyAuthError(error.message);
    redirect(`/auth/sign-up?error=${code}`);
  }

  redirect("/receiver");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  // Global scope revokes the refresh token on every device, which is what
  // users expect from "sign out" on a regulated-data app. See finding auth#12.
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) {
    // Don't block the user from landing on the home page if the server-side
    // revocation hits a transient error - the local cookie is already cleared.
    console.error("signOut: failed to revoke session", error);
  }
  redirect("/");
}

export async function inviteAdmin(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const displayName = (formData.get("display_name") as string | null) ?? null;

  // Re-read the caller's role from the server-side session. Never trust a
  // role hint from form input - this is the enforcement boundary.
  const callerRole = await getCurrentRole();

  if (callerRole !== "admin") {
    redirect("/auth/sign-in?error=admin_required");
  }

  // Read the caller's user ID for the invited_by field.
  const supabase = await createServerClient();
  const {
    data: { user: callerUser },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  // Use createUser (not inviteUserByEmail) so we can set app_metadata.invited_by.
  // Migration 0009's hardened trigger only honours raw_user_meta_data.role when
  // raw_app_meta_data.invited_by is present. Pattern matches signUpFamilyMember
  // in lib/care-circles/actions.ts.
  const { data: newUser, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      role: "admin",
      display_name: displayName,
    },
    app_metadata: {
      invited_by: callerUser?.id ?? null,
    },
  });

  if (error) {
    const code = classifyAuthError(error.message);
    redirect(`/admin/users/invite?error=${code}`);
  }

  // Send a password-reset link so the invited admin can set their password.
  const { error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError) {
    console.error("inviteAdmin: failed to generate login link", linkError);
  }

  await recordAuditEvent({
    action: "admin.invite",
    subjectTable: "auth.users",
    subjectId: newUser.user.id,
    after: { email, role: "admin", display_name: displayName },
  });

  redirect("/admin/users/invite?ok=1");
}
