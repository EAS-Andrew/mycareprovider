"use server";

import { redirect } from "next/navigation";

import { setProviderServices } from "@/lib/providers/profile-actions";

/**
 * Trampoline Server Action for the provider services page. Extracts the
 * checkbox values, calls the canonical action, and translates thrown
 * validation errors into `?error=` redirects so the page renders them in
 * the shared error-summary shape.
 */
export async function submitProviderServices(
  formData: FormData,
): Promise<void> {
  const ids = formData
    .getAll("service_category_id")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  try {
    await setProviderServices(ids);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(
      `/provider/onboarding/services?error=${encodeURIComponent(message)}`,
    );
  }

  redirect("/provider/onboarding/services?saved=1");
}
