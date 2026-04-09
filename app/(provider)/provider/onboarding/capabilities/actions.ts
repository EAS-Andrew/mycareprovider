"use server";

import { redirect } from "next/navigation";

import { setProviderCapabilities } from "@/lib/providers/profile-actions";

/**
 * Trampoline Server Action for the provider capabilities page. Same shape
 * as the services trampoline: collect the checkbox values, call the
 * canonical action, translate thrown validation errors to `?error=`.
 */
export async function submitProviderCapabilities(
  formData: FormData,
): Promise<void> {
  const ids = formData
    .getAll("capability_id")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  try {
    await setProviderCapabilities(ids);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(
      `/provider/onboarding/capabilities?error=${encodeURIComponent(message)}`,
    );
  }

  redirect("/provider/onboarding/capabilities?saved=1");
}
