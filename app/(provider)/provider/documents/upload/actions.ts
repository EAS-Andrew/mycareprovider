"use server";

import { redirect } from "next/navigation";
import { uploadProviderDocument } from "@/lib/documents/actions";
import { DisallowedUploadError } from "@/lib/documents/mime";

/**
 * Trampoline for the provider document upload form.
 *
 * `uploadProviderDocument` returns `{ documentId }` and throws on error; we
 * convert that into redirect-on-success and `?error=` on failure so the
 * upload page can render the message in the shared error-summary shape.
 * DisallowedUploadError gets a human-readable message tailored to the
 * specific failure code.
 */
export async function submitUpload(formData: FormData): Promise<void> {
  const from = (formData.get("from") as string | null) ?? null;

  try {
    await uploadProviderDocument(formData);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    let message: string;
    if (err instanceof DisallowedUploadError) {
      message =
        err.code === "mime_not_allowed"
          ? "That file type is not allowed. Upload a PDF or an image (JPEG, PNG, WebP, or HEIC)."
          : "That file is too large. The maximum size is 25 MB.";
    } else if (err instanceof Error) {
      message = err.message;
    } else {
      message = "Something went wrong";
    }
    const fromParam = from === "onboarding" ? "&from=onboarding" : "";
    redirect(
      `/provider/documents/upload?error=${encodeURIComponent(message)}${fromParam}`,
    );
  }

  // Return to dashboard if upload was initiated from the onboarding checklist
  if (from === "onboarding") {
    redirect("/provider?uploaded=1");
  }
  redirect("/provider/documents?uploaded=1");
}
