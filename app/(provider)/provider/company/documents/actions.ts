"use server";

import { redirect } from "next/navigation";
import { softDeleteDocument } from "@/lib/documents/actions";

/**
 * Trampoline for soft-deleting a company document. Mirrors the pattern in
 * app/(provider)/provider/documents/actions.ts.
 */
export async function submitCompanySoftDelete(
  formData: FormData,
): Promise<void> {
  const id = formData.get("document_id");
  if (typeof id !== "string" || id.length === 0) {
    redirect(
      `/provider/company/documents?error=${encodeURIComponent("Missing document id")}`,
    );
  }
  try {
    await softDeleteDocument(id);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    redirect(
      `/provider/company/documents?error=${encodeURIComponent(message)}`,
    );
  }
  redirect("/provider/company/documents?deleted=1");
}
