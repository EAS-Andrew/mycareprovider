"use server";

import { redirect } from "next/navigation";

import {
  addProviderCertification,
  softDeleteProviderCertification,
} from "@/lib/providers/profile-actions";

/**
 * Trampoline Server Actions for the certifications page. Two forms post
 * here: the "add certification" form and one per-row soft-delete form.
 * Both funnel errors through `?error=` so the page can surface them in
 * the shared error-summary shape.
 */

function optional(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function submitAddCertification(
  formData: FormData,
): Promise<void> {
  const certificationId = optional(formData, "certification_id") ?? "";
  const reference = optional(formData, "reference");
  const issuedOn = optional(formData, "issued_on");
  const expiresOn = optional(formData, "expires_on");
  const documentId = optional(formData, "document_id");

  try {
    await addProviderCertification({
      certificationId,
      reference,
      issuedOn,
      expiresOn,
      documentId,
    });
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(
      `/provider/onboarding/certifications?error=${encodeURIComponent(message)}`,
    );
  }

  redirect("/provider/onboarding/certifications?saved=1");
}

export async function submitDeleteCertification(
  formData: FormData,
): Promise<void> {
  const id = optional(formData, "id") ?? "";

  try {
    await softDeleteProviderCertification(id);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(
      `/provider/onboarding/certifications?error=${encodeURIComponent(message)}`,
    );
  }

  redirect("/provider/onboarding/certifications?deleted=1");
}
