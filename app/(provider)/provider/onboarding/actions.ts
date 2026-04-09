"use server";

import { redirect } from "next/navigation";
import { updateProviderProfile } from "@/lib/providers/actions";

/**
 * Trampoline Server Action for the provider onboarding form.
 *
 * The UI collects hourly rate as pounds so the provider does not have to do
 * mental pence arithmetic. We translate to pence server-side before calling
 * the canonical `updateProviderProfile` action. We also catch thrown
 * validation errors and redirect to `?error=` so the page can render them in
 * the shared error-summary shape, matching the pattern used by every other
 * form in the app.
 */
export async function submitProviderProfile(
  formData: FormData,
): Promise<void> {
  const poundsRaw = formData.get("hourly_rate_pounds");
  if (typeof poundsRaw === "string" && poundsRaw.length > 0) {
    const pounds = Number(poundsRaw);
    if (!Number.isFinite(pounds) || pounds < 0) {
      redirect(
        `/provider/onboarding?error=${encodeURIComponent(
          "Hourly rate must be a non-negative number",
        )}`,
      );
    }
    formData.set("hourly_rate_pence", String(Math.round(pounds * 100)));
  }
  formData.delete("hourly_rate_pounds");

  try {
    await updateProviderProfile(formData);
  } catch (err) {
    // Let Next.js redirect errors propagate; they carry a `digest` field.
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(`/provider/onboarding?error=${encodeURIComponent(message)}`);
  }
}
