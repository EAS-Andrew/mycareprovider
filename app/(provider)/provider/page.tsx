import Link from "next/link";
import { getOwnProviderProfile } from "@/lib/providers/actions";
import { getOwnProviderProfileWithCatalog } from "@/lib/providers/catalog";
import type { ProviderProfileRow } from "@/lib/providers/types";
import { listOwnDocuments } from "@/lib/documents/actions";
import type {
  DocumentKind,
  ProviderDocumentRow,
} from "@/lib/documents/types";

type ChecklistState = "done" | "missing" | "in_review" | "rejected";

type ChecklistRow = {
  id: string;
  label: string;
  description: string;
  href: string;
  hrefLabel: string;
  state: ChecklistState;
  detail: string | null;
};

function profileIsComplete(profile: ProviderProfileRow | null): boolean {
  if (!profile) return false;
  return Boolean(
    profile.headline &&
      profile.phone &&
      profile.postcode &&
      profile.hourly_rate_pence !== null,
  );
}

function documentRowState(
  kind: DocumentKind,
  documents: ProviderDocumentRow[],
): { state: ChecklistState; detail: string | null } {
  const ofKind = documents.filter((d) => d.kind === kind);
  if (ofKind.length === 0) {
    return { state: "missing", detail: null };
  }
  const hasApproved = ofKind.some((d) => d.verification_state === "approved");
  if (hasApproved) {
    return { state: "done", detail: "Approved" };
  }
  const rejected = ofKind.find((d) => d.verification_state === "rejected");
  if (rejected) {
    return {
      state: "rejected",
      detail: rejected.verification_notes ?? "Rejected. Please re-upload.",
    };
  }
  return { state: "in_review", detail: "Uploaded, awaiting review" };
}

const STATE_STYLES: Record<ChecklistState, { label: string; className: string }> = {
  done: {
    label: "Done",
    className: "border-success text-success",
  },
  missing: {
    label: "Missing",
    className: "border-border text-ink-muted",
  },
  in_review: {
    label: "In review",
    className: "border-warning text-warning",
  },
  rejected: {
    label: "Rejected",
    className: "border-danger text-danger",
  },
};

function StatusBadge({ state }: { state: ChecklistState }) {
  const { label, className } = STATE_STYLES[state];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

export default async function ProviderHome() {
  const [profile, documents, catalog] = await Promise.all([
    getOwnProviderProfile(),
    listOwnDocuments(),
    getOwnProviderProfileWithCatalog(),
  ]);

  const profileDone = profileIsComplete(profile);
  const identity = documentRowState("identity", documents);
  const dbs = documentRowState("dbs", documents);
  const insurance = documentRowState("insurance", documents);
  const certification = documentRowState("certification", documents);
  const serviceCount = catalog?.serviceCategoryIds.length ?? 0;
  const capabilityCount = catalog?.capabilityIds.length ?? 0;

  const checklist: ChecklistRow[] = [
    {
      id: "profile",
      label: "Complete your profile",
      description:
        "Tell care receivers who you are, your experience, and your hourly rate.",
      href: "/provider/onboarding",
      hrefLabel: profile ? "Edit profile" : "Start profile",
      state: profileDone ? "done" : "missing",
      detail: profileDone
        ? null
        : profile
          ? "Profile started - a few required fields still missing."
          : null,
    },
    {
      id: "services",
      label: "Select at least one service",
      description:
        "Tell care receivers which types of care you are comfortable offering.",
      href: "/provider/onboarding/services",
      hrefLabel: serviceCount > 0 ? "Edit services" : "Choose services",
      state: serviceCount > 0 ? "done" : "missing",
      detail:
        serviceCount > 0
          ? `${serviceCount} ${serviceCount === 1 ? "service" : "services"} selected`
          : null,
    },
    {
      id: "capabilities",
      label: "Select at least one capability",
      description:
        "List the specific training or skills you hold so families can find the right carer.",
      href: "/provider/onboarding/capabilities",
      hrefLabel:
        capabilityCount > 0 ? "Edit capabilities" : "Choose capabilities",
      state: capabilityCount > 0 ? "done" : "missing",
      detail:
        capabilityCount > 0
          ? `${capabilityCount} ${capabilityCount === 1 ? "capability" : "capabilities"} selected`
          : null,
    },
    {
      id: "identity",
      label: "Upload proof of identity",
      description: "Passport, driving licence, or national ID card.",
      href: "/provider/documents/upload",
      hrefLabel: "Upload",
      state: identity.state,
      detail: identity.detail,
    },
    {
      id: "dbs",
      label: "Upload DBS check",
      description:
        "Enhanced DBS certificate. Live integration ships later - for now, upload a scan.",
      href: "/provider/documents/upload",
      hrefLabel: "Upload",
      state: dbs.state,
      detail: dbs.detail,
    },
    {
      id: "insurance",
      label: "Upload insurance",
      description: "Public liability or professional indemnity certificate.",
      href: "/provider/documents/upload",
      hrefLabel: "Upload",
      state: insurance.state,
      detail: insurance.detail,
    },
    {
      id: "certification",
      label: "Upload at least one certification",
      description:
        "NVQ, first aid, medication training, or equivalent. You can add more later.",
      href: "/provider/documents/upload",
      hrefLabel: "Upload",
      state: certification.state,
      detail: certification.detail,
    },
  ];

  const completeCount = checklist.filter((row) => row.state === "done").length;

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Welcome, care provider
        </h1>
        <p className="text-ink-muted">
          Complete the steps below to get your profile verified and visible to
          care receivers.
        </p>
      </header>

      {!profile ? (
        <div className="rounded-lg border border-brand bg-surface p-5">
          <p className="text-sm text-ink">
            You have not started your profile yet. This is the first thing care
            receivers will see once your documents are approved.
          </p>
          <Link
            href="/provider/onboarding"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Start your profile
          </Link>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">
            Onboarding checklist
          </h2>
          <span className="text-sm text-ink-muted" aria-live="polite">
            {completeCount} of {checklist.length} complete
          </span>
        </div>
        <ul className="divide-y divide-border">
          {checklist.map((row) => (
            <li key={row.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <StatusBadge state={row.state} />
                  <p className="font-medium text-ink">{row.label}</p>
                </div>
                <p className="mt-1 text-sm text-ink-muted">{row.description}</p>
                {row.detail ? (
                  <p className="mt-1 text-sm text-ink">{row.detail}</p>
                ) : null}
              </div>
              <Link
                href={row.href}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              >
                {row.hrefLabel}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink">Your documents</h2>
        <p className="mt-1 text-sm text-ink-muted">
          View everything you have uploaded and check the review status.
        </p>
        <Link
          href="/provider/documents"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-brand px-4 text-sm font-medium text-brand transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        >
          Open document vault
        </Link>
      </div>
    </section>
  );
}
