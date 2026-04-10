import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCareCircle,
  getCareCircleForMember,
  getCareCircleMembers,
} from "@/lib/care-circles/queries";
import { getFamilyAuthorisations } from "@/lib/care-circles/queries";
import { uploadAuthorisationDocument } from "@/lib/care-circles/actions";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";
import {
  AUTHORISATION_LABELS,
  AUTHORISATION_TYPES,
  type AuthorisationType,
} from "@/lib/care-circles/types";

export const metadata = {
  title: "Family member - MyCareProvider",
};

type PageProps = {
  params: Promise<{ memberId: string }>;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function MemberDetailPage({ params }: PageProps) {
  const { memberId } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user ? await getCurrentRole(supabase, user) : null;

  const circle =
    role === "receiver"
      ? await getCareCircle()
      : await getCareCircleForMember();

  if (!circle) notFound();

  const members = await getCareCircleMembers(circle.id);
  const member = members.find((m) => m.id === memberId);
  if (!member) notFound();

  const authorisations = await getFamilyAuthorisations(memberId);

  const isOwnProfile = member.profile_id === user?.id;

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href="/receiver/family"
          className="text-sm text-ink-muted hover:text-ink"
        >
          &larr; Back to family circle
        </Link>
        <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight text-ink">
          {member.display_name ?? "Family member"}
        </h1>
        <div className="mt-2 flex flex-wrap gap-3 text-sm text-ink-muted">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              member.role === "primary"
                ? "border-brand text-brand"
                : "border-border text-ink-muted"
            }`}
          >
            {member.role === "primary" ? "Primary" : "Member"}
          </span>
          <span>
            {member.accepted_at
              ? `Joined ${formatDate(member.accepted_at)}`
              : `Invited ${formatDate(member.invited_at)}`}
          </span>
        </div>
      </header>

      {/* Authorisation documents */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-ink">
            Authorisation documents
          </h2>
        </div>

        {authorisations.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center">
            <p className="text-sm text-ink-muted">
              No authorisation documents uploaded yet.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {authorisations.map((auth) => (
              <li key={auth.id} className="px-5 py-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {auth.document_title ?? "Document"}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {AUTHORISATION_LABELS[auth.authorisation_type as AuthorisationType] ??
                        auth.authorisation_type}
                    </p>
                    {auth.notes && (
                      <p className="mt-1 text-sm text-ink-muted">
                        {auth.notes}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-muted">
                      <span>Granted {formatDate(auth.granted_at)}</span>
                      {auth.expires_at && (
                        <span>Expires {formatDate(auth.expires_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {auth.verified_at ? (
                      <span className="inline-flex items-center rounded-full border border-success px-2.5 py-0.5 text-xs font-medium text-success">
                        Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                        Pending verification
                      </span>
                    )}
                    {auth.document_status && (
                      <span className="text-xs text-ink-muted">
                        Document: {auth.document_status}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Upload form - only visible to the member themselves */}
        {isOwnProfile && (
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-base font-semibold text-ink">
              Upload authorisation document
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              Upload a Power of Attorney, legal guardianship, or other
              authorisation document.
            </p>

            <form
              action={async (formData: FormData) => {
                "use server";
                await uploadAuthorisationDocument(formData);
              }}
              className="mt-4 space-y-4"
              encType="multipart/form-data"
              noValidate
            >
              <input type="hidden" name="member_id" value={memberId} />

              <div className="space-y-2">
                <label
                  htmlFor="authorisation_type"
                  className="block text-sm font-medium text-ink"
                >
                  Type
                </label>
                <select
                  id="authorisation_type"
                  name="authorisation_type"
                  required
                  className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink ring-offset-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                >
                  {AUTHORISATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {AUTHORISATION_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="title"
                  className="block text-sm font-medium text-ink"
                >
                  Document title
                </label>
                <Input id="title" name="title" type="text" required />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="file"
                  className="block text-sm font-medium text-ink"
                >
                  File
                </label>
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                  required
                />
                <p className="text-xs text-ink-muted">
                  PDF, JPEG, PNG, WebP, or HEIC. Max 25 MB.
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="expires_at"
                  className="block text-sm font-medium text-ink"
                >
                  Expiry date (optional)
                </label>
                <Input
                  id="expires_at"
                  name="expires_at"
                  type="date"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="notes"
                  className="block text-sm font-medium text-ink"
                >
                  Notes (optional)
                </label>
                <Input id="notes" name="notes" type="text" />
              </div>

              <Button type="submit">Upload document</Button>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
