import Link from "next/link";
import { Input } from "@/components/ui/input";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/documents/types";
import { ALLOWED_MIME_TYPES, MAX_SIZE_BYTES } from "@/lib/documents/mime";
import { submitCompanyUpload } from "./actions";

export const metadata = {
  title: "Upload a company document - MyCareProvider",
};

const KIND_LABELS: Record<DocumentKind, string> = {
  dbs: "DBS certificate",
  insurance: "Insurance certificate",
  certification: "Certification or training",
  identity: "Proof of identity",
  right_to_work: "Right to work",
  other: "Other",
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

function formatMaxSize(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export default async function CompanyUploadPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const acceptAttr = ALLOWED_MIME_TYPES.join(",");

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          Upload a company document
        </h1>
        <p className="text-ink-muted">
          All documents are reviewed by our team before they become part of
          your verified company profile.
        </p>
      </header>

      {error ? (
        <div
          id="form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <form
        action={submitCompanyUpload}
        encType="multipart/form-data"
        className="space-y-5 rounded-2xl border border-border bg-surface p-6"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="kind"
            className="block text-sm font-medium text-ink"
          >
            Document type
          </label>
          <select
            id="kind"
            name="kind"
            required
            defaultValue=""
            aria-describedby={error ? "form-error" : undefined}
            className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
          >
            <option value="" disabled>
              Select a type
            </option>
            {DOCUMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="title"
            className="block text-sm font-medium text-ink"
          >
            Title
          </label>
          <Input
            id="title"
            name="title"
            type="text"
            maxLength={200}
            required
            aria-describedby={error ? "form-error" : "title-hint"}
          />
          <p id="title-hint" className="text-xs text-ink-muted">
            A short name, for example &quot;Public liability insurance 2025&quot;.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="description"
            className="block text-sm font-medium text-ink"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            aria-describedby={error ? "form-error" : "description-hint"}
            className="flex w-full rounded-md border border-border bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring aria-[invalid=true]:border-danger"
          />
          <p id="description-hint" className="text-xs text-ink-muted">
            Optional. Anything our reviewers should know.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="expires_at"
            className="block text-sm font-medium text-ink"
          >
            Expiry date
          </label>
          <Input
            id="expires_at"
            name="expires_at"
            type="date"
            aria-describedby={error ? "form-error" : "expires-hint"}
          />
          <p id="expires-hint" className="text-xs text-ink-muted">
            Optional. Leave blank if the document does not expire.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="file"
            className="block text-sm font-medium text-ink"
          >
            File
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept={acceptAttr}
            aria-describedby={error ? "form-error" : "file-hint"}
            className="block w-full text-sm text-ink file:mr-4 file:h-10 file:rounded-md file:border file:border-brand file:bg-canvas file:px-4 file:text-sm file:font-medium file:text-brand hover:file:bg-brand hover:file:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          />
          <p id="file-hint" className="text-xs text-ink-muted">
            PDF or image (JPEG, PNG, WebP, HEIC). Max {formatMaxSize(MAX_SIZE_BYTES)}.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Upload
          </button>
          <Link
            href="/provider/company/documents"
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
