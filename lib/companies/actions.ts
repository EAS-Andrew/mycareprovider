"use server";

import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getCurrentRole } from "@/lib/auth/current-role";
import { geocodePostcode, isLikelyUkPostcode } from "@/lib/geo/postcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

import type { CompanyProfileRow } from "./types";

/**
 * C3b company Server Actions.
 *
 * Mirrors the shape of `lib/providers/actions.ts`: every mutating action goes
 * through the user-scoped Supabase client so RLS is the enforcement boundary,
 * and every mutation writes a W2 audit event via `recordAuditEvent`.
 * `verified_at` is never accepted from form input - the db guard trigger on
 * `provider_companies` would reject it anyway, but we strip it server-side
 * so a partial form post cannot even smuggle it in.
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

const PHONE_RE = /^[0-9 ()+-]+$/;

export async function signUpCompany(formData: FormData): Promise<void> {
  const email = formString(formData, "email");
  const password = formString(formData, "password");
  const companyName = formString(formData, "company_name");
  const displayName = optionalString(formData, "display_name") ?? companyName;

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Role is set server-side, never from user input. The
      // handle_new_auth_user trigger reads raw_user_meta_data.role.
      // See migration 0009 for the role-escalation guard - same treatment
      // as provider sign-up.
      data: {
        role: "provider_company",
        display_name: displayName,
      },
    },
  });

  if (error) {
    redirect(
      `/auth/company-sign-up?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Migration 0009 hardened handle_new_auth_user to ignore
  // raw_user_meta_data.role on public sign-ups, so the trigger creates the
  // profile as 'receiver' by default. Use the admin client to set the
  // correct role post-signup.
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) {
    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({ role: "provider_company" })
      .eq("id", authData.user.id);
  }

  await recordAuditEvent({
    action: "company.signup",
    subjectTable: "auth.users",
    subjectId: email,
    after: { email, role: "provider_company", company_name: companyName },
  });

  redirect("/provider/company?welcome=1");
}

export async function updateCompanyProfile(
  formData: FormData,
): Promise<void> {
  // Strip fields that must never come from user input.
  formData.delete("verified_at");
  formData.delete("id");
  formData.delete("deleted_at");
  formData.delete("created_at");
  formData.delete("updated_at");
  formData.delete("latitude");
  formData.delete("longitude");
  formData.delete("geocoded_at");

  const companyName = formString(formData, "company_name");
  const companyNumber = optionalString(formData, "company_number");
  const registeredAddress = optionalString(formData, "registered_address");
  const servicePostcodeRaw = optionalString(formData, "service_postcode");
  const servicePostcode = servicePostcodeRaw?.trim() ?? null;
  const description = optionalString(formData, "description");
  const website = optionalString(formData, "website");
  const phoneRaw = optionalString(formData, "phone");
  if (phoneRaw !== null && !PHONE_RE.test(phoneRaw)) {
    throw new Error("Phone must contain only digits, spaces, parentheses, + or -");
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?error=sign-in-required");
  }

  const callerRole = await getCurrentRole(supabase, user);
  if (callerRole !== "provider_company") {
    redirect("/auth/sign-in?error=company-required");
  }

  const profileId = user.id;

  const { data: existing } = await supabase
    .from("provider_companies")
    .select("id, latitude, longitude, service_postcode, geocoded_at")
    .eq("id", profileId)
    .maybeSingle();

  let latitude: number | null =
    (existing?.latitude as number | null | undefined) ?? null;
  let longitude: number | null =
    (existing?.longitude as number | null | undefined) ?? null;
  let geocodedAt: string | null =
    (existing?.geocoded_at as string | null | undefined) ?? null;

  const existingServicePostcode =
    (existing?.service_postcode as string | null | undefined) ?? null;
  const postcodeChanged = servicePostcode !== existingServicePostcode;

  if (servicePostcode === null) {
    latitude = null;
    longitude = null;
    geocodedAt = null;
  } else if (postcodeChanged) {
    if (!isLikelyUkPostcode(servicePostcode)) {
      throw new Error(
        "That postcode does not look like a UK postcode. Double-check and try again.",
      );
    }
    const geocoded = await geocodePostcode(servicePostcode);
    if (geocoded === null) {
      throw new Error(
        "We could not find that postcode. Check it and try again, or leave it blank to skip location.",
      );
    }
    latitude = geocoded.lat;
    longitude = geocoded.lng;
    geocodedAt = new Date().toISOString();
  }

  const payload = {
    id: profileId,
    company_name: companyName,
    company_number: companyNumber,
    registered_address: registeredAddress,
    service_postcode: servicePostcode,
    latitude,
    longitude,
    geocoded_at: geocodedAt,
    description,
    website,
    phone: phoneRaw,
  };

  if (existing === null) {
    const { error } = await supabase
      .from("provider_companies")
      .insert(payload);
    if (error) {
      redirect(
        `/provider/company/profile?error=${encodeURIComponent(error.message)}`,
      );
    }
  } else {
    const { error } = await supabase
      .from("provider_companies")
      .update(payload)
      .eq("id", profileId);
    if (error) {
      redirect(
        `/provider/company/profile?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  await recordAuditEvent({
    action: "company.profile.update",
    subjectTable: "public.provider_companies",
    subjectId: profileId,
    after: {
      company_name: companyName,
      company_number: companyNumber,
      description,
      website,
    },
  });

  redirect("/provider/company/profile?saved=1");
}

export async function inviteMember(formData: FormData): Promise<void> {
  const providerIdRaw = formString(formData, "provider_id");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?error=sign-in-required");
  }

  const callerRole = await getCurrentRole(supabase, user);
  if (callerRole !== "provider_company") {
    redirect("/auth/sign-in?error=company-required");
  }

  const { error } = await supabase.from("company_memberships").insert({
    company_id: user.id,
    provider_id: providerIdRaw,
    role: "member",
    invited_by: user.id,
    invited_at: new Date().toISOString(),
  });

  if (error) {
    redirect(
      `/provider/company/members?error=${encodeURIComponent(error.message)}`,
    );
  }

  await recordAuditEvent({
    action: "company.member.invite",
    subjectTable: "public.company_memberships",
    subjectId: providerIdRaw,
    after: { company_id: user.id, provider_id: providerIdRaw, role: "member" },
  });

  redirect("/provider/company/members?invited=1");
}

export async function acceptInvitation(formData: FormData): Promise<void> {
  const membershipId = formString(formData, "membership_id");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?error=sign-in-required");
  }

  const { error } = await supabase
    .from("company_memberships")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", membershipId)
    .eq("provider_id", user.id)
    .is("accepted_at", null)
    .is("removed_at", null);

  if (error) {
    throw new Error(`acceptInvitation: ${error.message}`);
  }

  await recordAuditEvent({
    action: "company.member.accept",
    subjectTable: "public.company_memberships",
    subjectId: membershipId,
    after: { provider_id: user.id },
  });
}

export async function removeMember(formData: FormData): Promise<void> {
  const membershipId = formString(formData, "membership_id");

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?error=sign-in-required");
  }

  const callerRole = await getCurrentRole(supabase, user);
  if (callerRole !== "provider_company" && callerRole !== "admin") {
    redirect("/auth/sign-in?error=company-required");
  }

  const { error } = await supabase
    .from("company_memberships")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", membershipId);

  if (error) {
    redirect(
      `/provider/company/members?error=${encodeURIComponent(error.message)}`,
    );
  }

  await recordAuditEvent({
    action: "company.member.remove",
    subjectTable: "public.company_memberships",
    subjectId: membershipId,
  });

  redirect("/provider/company/members?removed=1");
}
