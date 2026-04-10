"use server";

import { redirect } from "next/navigation";
import { uploadCompanyDocument } from "@/lib/companies/upload";
import { DisallowedUploadError } from "@/lib/documents/mime";

export async function submitCompanyUpload(formData: FormData): Promise<void> {
  try {
    await uploadCompanyDocument(formData);
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
    redirect(
      `/provider/company/documents/upload?error=${encodeURIComponent(message)}`,
    );
  }
  redirect("/provider/company/documents?uploaded=1");
}
