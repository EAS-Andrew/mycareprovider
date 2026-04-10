import { getCompanyMembers } from "@/lib/companies/queries";
import { inviteMember, removeMember } from "@/lib/companies/actions";
import { Input } from "@/components/ui/input";

export const metadata = {
  title: "Team members - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{
    error?: string;
    invited?: string;
    removed?: string;
  }>;
};

export default async function CompanyMembersPage({ searchParams }: PageProps) {
  const { error, invited, removed } = await searchParams;
  const members = await getCompanyMembers();

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
          Team members
        </h1>
        <p className="mt-1 text-ink-muted">
          Invite individual care providers to join your company. They must have
          an existing provider account on MyCareProvider.
        </p>
      </header>

      {invited ? (
        <div
          role="status"
          className="rounded-xl border border-success bg-surface p-3 text-sm text-ink"
        >
          Invitation sent.
        </div>
      ) : null}

      {removed ? (
        <div
          role="status"
          className="rounded-xl border border-brand bg-surface p-3 text-sm text-ink"
        >
          Member removed.
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

      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-ink">
          Invite a provider
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Enter the provider&apos;s profile ID to send them an invitation.
        </p>
        <form action={inviteMember} className="mt-4 flex gap-3" noValidate>
          <Input
            id="provider_id"
            name="provider_id"
            type="text"
            required
            placeholder="Provider profile ID"
            className="flex-1"
          />
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-brand px-5 text-base font-medium text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            Invite
          </button>
        </form>
      </div>

      {members.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-sm text-ink-muted">
            No team members yet. Invite individual providers to join your
            company.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-heading text-lg font-semibold text-ink">
              Current members ({members.length})
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {member.provider_display_name ?? member.provider_id}
                  </p>
                  <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
                    <div>
                      <dt className="inline">Role: </dt>
                      <dd className="inline text-ink">{member.role}</dd>
                    </div>
                    <div>
                      <dt className="inline">Invited: </dt>
                      <dd className="inline text-ink">
                        {member.invited_at.slice(0, 10)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Status: </dt>
                      <dd className="inline text-ink">
                        {member.accepted_at ? "Active" : "Pending"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <details className="group shrink-0 rounded-xl">
                  <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center rounded-xl border border-danger px-4 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring [&::-webkit-details-marker]:hidden">
                    Remove
                  </summary>
                  <form
                    action={removeMember}
                    className="mt-2 flex flex-col gap-2 rounded-xl border border-danger bg-canvas p-3 text-sm text-ink"
                  >
                    <input
                      type="hidden"
                      name="membership_id"
                      value={member.id}
                    />
                    <p>
                      Remove{" "}
                      <span className="font-medium">
                        {member.provider_display_name ?? member.provider_id}
                      </span>
                      ?
                    </p>
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center justify-center rounded-xl bg-danger px-4 text-sm font-medium text-canvas transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                      aria-label={`Confirm removal of ${member.provider_display_name ?? member.provider_id}`}
                    >
                      Confirm remove
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
