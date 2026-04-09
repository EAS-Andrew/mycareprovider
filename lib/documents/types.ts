/**
 * Non-async exports for the documents module. `lib/documents/actions.ts` is
 * a `"use server"` file, which means Next.js only allows async-function
 * exports from it. Constants, enums, and type aliases live here so form
 * components can import them without dragging the "use server" boundary
 * into client code.
 */

export const PROVIDER_DOCS_BUCKET = "provider-docs";

export const DOCUMENT_KINDS = [
  "dbs",
  "insurance",
  "certification",
  "identity",
  "right_to_work",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export type UploadProviderDocumentResult = {
  documentId: string;
};

export type ProviderDocumentRow = {
  id: string;
  kind: DocumentKind;
  title: string;
  description: string | null;
  mime_type: string;
  size_bytes: number;
  status: "quarantined" | "available" | "rejected";
  rejected_reason: string | null;
  expires_at: string | null;
  created_at: string;
  verification_state: "pending" | "in_review" | "approved" | "rejected" | null;
  verification_notes: string | null;
  verification_reviewed_at: string | null;
};
