"use server";

import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

type AppRole =
  | "admin"
  | "provider"
  | "provider_company"
  | "receiver"
  | "family_member";

const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  provider: "/provider",
  provider_company: "/provider",
  receiver: "/receiver",
  family_member: "/receiver",
};

function homeForRole(role: string | null | undefined): string {
  if (role && role in ROLE_HOME) {
    return ROLE_HOME[role as AppRole];
  }
  return "/";
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
  const next = (formData.get("next") as string | null) ?? null;

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/auth/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  const role =
    (data.user?.app_metadata?.app_role as string | undefined) ??
    (data.user?.user_metadata?.role as string | undefined) ??
    null;

  redirect(next && next.startsWith("/") ? next : homeForRole(role));
}

export async function signUp(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const password = formString(formData, "password");
  const displayName = (formData.get("display_name") as string | null) ?? null;

  // Public sign-up is receiver-only. Provider, company, family, and admin
  // roles are invite-only and land via `inviteAdmin` or future invite flows.
  const role: AppRole = "receiver";

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role,
        display_name: displayName,
      },
    },
  });

  if (error) {
    redirect(`/auth/sign-up?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/receiver");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function inviteAdmin(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const displayName = (formData.get("display_name") as string | null) ?? null;

  // Re-read the caller's role from the server-side session. Never trust a
  // role hint from form input - this is the enforcement boundary.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const callerRole =
    (user?.app_metadata?.app_role as string | undefined) ??
    (user?.user_metadata?.role as string | undefined) ??
    null;

  if (callerRole !== "admin") {
    redirect("/auth/sign-in?error=admin-required");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      role: "admin",
      display_name: displayName,
    },
  });

  if (error) {
    redirect(`/admin/users/invite?error=${encodeURIComponent(error.message)}`);
  }

  await recordAuditEvent({
    action: "admin.invite",
    subjectTable: "auth.users",
    subjectId: email,
    after: { email, role: "admin", display_name: displayName },
  });

  redirect("/admin/users/invite?ok=1");
}
