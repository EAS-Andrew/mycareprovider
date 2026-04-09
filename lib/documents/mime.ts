/**
 * MIME + size allow-list for provider document uploads.
 *
 * Canonical list per the C3a section of `docs/pid.md` and
 * `supabase/config.toml`. Every upload Server Action MUST call
 * `assertAllowedUpload` before touching storage or inserting a row.
 */

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_SIZE_BYTES = 25 * 1024 * 1024;

export class DisallowedUploadError extends Error {
  readonly code: "mime_not_allowed" | "file_too_large";

  constructor(code: "mime_not_allowed" | "file_too_large", message: string) {
    super(message);
    this.name = "DisallowedUploadError";
    this.code = code;
  }
}

export function assertAllowedUpload(params: {
  mimeType: string;
  sizeBytes: number;
}): void {
  if (
    !(ALLOWED_MIME_TYPES as readonly string[]).includes(params.mimeType)
  ) {
    throw new DisallowedUploadError(
      "mime_not_allowed",
      `File type not allowed: ${params.mimeType}`,
    );
  }
  if (params.sizeBytes <= 0) {
    throw new DisallowedUploadError(
      "file_too_large",
      "File is empty",
    );
  }
  if (params.sizeBytes > MAX_SIZE_BYTES) {
    throw new DisallowedUploadError(
      "file_too_large",
      `File exceeds ${MAX_SIZE_BYTES} bytes`,
    );
  }
}
