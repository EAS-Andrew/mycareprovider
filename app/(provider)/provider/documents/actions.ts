"use server";

import { redirect } from "next/navigation";
import { softDeleteDocument } from "@/lib/documents/actions";

/**
 * Trampoline for soft-deleting a document from the provider's vault.
 *
 * The canonical `softDeleteDocument` throws; this wrapper converts that into
 * a `?error=` redirect so the vault page can render the message in the
 * shared error-summary shape. On success it redirects back to the vault with
 * `?deleted=1`.
 */
export async function submitSoftDelete(formData: FormData): Promise<void> {
  const id = formData.get("document_id");
  if (typeof id !== "string" || id.length === 0) {
    redirect(
      `/provider/documents?error=${encodeURIComponent("Missing document id")}`,
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
    redirect(`/provider/documents?error=${encodeURIComponent(message)}`);
  }
  redirect("/provider/documents?deleted=1");
}
