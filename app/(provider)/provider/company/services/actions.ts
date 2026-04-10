"use server";

import { redirect } from "next/navigation";

import { setCompanyServices } from "@/lib/companies/profile-actions";

export async function submitCompanyServices(
  formData: FormData,
): Promise<void> {
  const ids = formData
    .getAll("service_category_id")
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  try {
    await setCompanyServices(ids);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(
      `/provider/company/services?error=${encodeURIComponent(message)}`,
    );
  }

  redirect("/provider/company/services?saved=1");
}
