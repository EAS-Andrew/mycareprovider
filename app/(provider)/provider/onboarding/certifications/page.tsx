import Link from "next/link";
import { redirect } from "next/navigation";

import { Input } from "@/components/ui/input";
import { listOwnDocuments } from "@/lib/documents/actions";
import {
  getProviderProfileWithCatalog,
  listCertifications,
} from "@/lib/providers/catalog";
import { createServerClient } from "@/lib/supabase/server";

import {
  submitAddCertification,
  submitDeleteCertification,
} from "./actions";

export const metadata = {
  title: "Certifications - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
};

export default async function ProviderCertificationsPage({
  searchParams,
}: PageProps) {
  const { error, saved, deleted } = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      "/auth/sign-in?error=sign-in-required&next=/provider/onboarding/certifications",
    );
  }

  const [certifications, selection, documents] = await Promise.all([
    listCertifications(),
    getProviderProfileWithCatalog(user.id),
    listOwnDocuments(),
  ]);
  const certDocs = documents.filter((d) => d.kind === "certification");

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          Certifications
        </h1>
        <p className="text-ink-muted">
          Add each certificate you hold. Linking a scanned copy from your
          document vault speeds up verification.
        </p>
      </header>

      {saved ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          Certification added.
        </div>
      ) : null}
      {deleted ? (
        <div
          role="status"
          className="rounded-xl border border-border bg-surface p-3 text-sm text-ink"
        >
          Certification removed.
        </div>
      ) : null}
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

      <div className="rounded-2xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-heading text-lg font-semibold text-ink">
            Your certifications
          </h2>
        </div>
        {selection.certifications.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            No certifications added yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {selection.certifications.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {row.certification?.name ?? "Unknown certification"}
                  </p>
                  <dl className="mt-1 space-y-0.5 text-xs text-ink-muted">
                    {row.reference ? (
                      <div>
                        <dt className="inline">Reference: </dt>
                        <dd className="inline">{row.reference}</dd>
                      </div>
                    ) : null}
                    {row.issued_on ? (
                      <div>
                        <dt className="inline">Issued: </dt>
                        <dd className="inline">{row.issued_on}</dd>
                      </div>
                    ) : null}
                    {row.expires_on ? (
                      <div>
                        <dt className="inline">Expires: </dt>
                        <dd className="inline">{row.expires_on}</dd>
                      </div>
                    ) : null}
                    {row.document_title ? (
                      <div>
                        <dt className="inline">Document: </dt>
                        <dd className="inline">{row.document_title}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                <form action={submitDeleteCertification}>
                  <input type="hidden" name="id" value={row.id} />
                  <button
                    type="submit"
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-border px-3 text-sm font-medium text-ink transition-colors hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        action={submitAddCertification}
        className="space-y-5 rounded-2xl border border-border bg-surface p-6"
        noValidate
      >
        <h2 className="font-heading text-lg font-semibold text-ink">Add a certification</h2>

        <div className="space-y-2">
          <label
            htmlFor="certification_id"
            className="block text-sm font-medium text-ink"
          >
            Certification type
          </label>
          <select
            id="certification_id"
            name="certification_id"
            required
            defaultValue=""
            aria-describedby={error ? "form-error" : "cert-hint"}
            className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <option value="" disabled>
              Select...
            </option>
            {certifications.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.expires ? " (expiry required)" : ""}
              </option>
            ))}
          </select>
          <p id="cert-hint" className="text-xs text-ink-muted">
            Some certifications require an expiry date.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="reference"
            className="block text-sm font-medium text-ink"
          >
            Reference number (optional)
          </label>
          <Input
            id="reference"
            name="reference"
            type="text"
            maxLength={120}
            aria-describedby={error ? "form-error" : undefined}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="issued_on"
              className="block text-sm font-medium text-ink"
            >
              Issued on
            </label>
            <Input
              id="issued_on"
              name="issued_on"
              type="date"
              aria-describedby={error ? "form-error" : undefined}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="expires_on"
              className="block text-sm font-medium text-ink"
            >
              Expires on
            </label>
            <Input
              id="expires_on"
              name="expires_on"
              type="date"
              aria-describedby={error ? "form-error" : undefined}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="document_id"
            className="block text-sm font-medium text-ink"
          >
            Linked document (optional)
          </label>
          <select
            id="document_id"
            name="document_id"
            defaultValue=""
            className="flex h-11 w-full rounded-md border border-border bg-canvas px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <option value="">None</option>
            {certDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            Need to upload a new one?{" "}
            <Link
              href="/provider/documents/upload"
              className="text-brand underline"
            >
              Upload a certification document
            </Link>
            .
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Add certification
          </button>
          <Link
            href="/provider/onboarding"
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Back to onboarding
          </Link>
        </div>
      </form>
    </section>
  );
}
