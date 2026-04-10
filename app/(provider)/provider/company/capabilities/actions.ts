"use server";

import { redirect } from "next/navigation";

import { setCompanyCapabilities } from "@/lib/companies/profile-actions";

export async function submitCompanyCapabilities(
  formData: FormData,
): Promise<void> {
  const ids = formData
    .getAll("capability_id")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  try {
    await setCompanyCapabilities(ids);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(
      `/provider/company/capabilities?error=${encodeURIComponent(message)}`,
    );
  }

  redirect("/provider/company/capabilities?saved=1");
}
