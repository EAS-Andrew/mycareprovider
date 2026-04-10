import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  getCareCircle,
  getCareCircleForMember,
  getCareCircleMembers,
  getPendingInvitations,
} from "@/lib/care-circles/queries";
import { getCurrentRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";
import { removeMember } from "@/lib/care-circles/actions";

export const metadata = {
  title: "Family circle - MyCareProvider",
};

type PageProps = {
  searchParams: Promise<{ invited?: string }>;
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

export default async function FamilyCirclePage({ searchParams }: PageProps) {
  const { invited } = await searchParams;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user ? await getCurrentRole(supabase, user) : null;

  // Receivers see their own circle; family members see the circle they belong to
  const circle =
    role === "receiver"
      ? await getCareCircle()
      : await getCareCircleForMember();

  const members = circle ? await getCareCircleMembers(circle.id) : [];
  const pendingInvites = circle ? await getPendingInvitations(circle.id) : [];

  const isReceiver = role === "receiver";

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-ink">
            {circle?.name ?? "Family circle"}
          </h1>
          <p className="mt-2 text-ink-muted">
            {isReceiver
              ? "Manage the family members who help coordinate your care."
              : "Your family care circle."}
          </p>
        </div>
        {(isReceiver || members.some((m) => m.profile_id === user?.id && m.role === "primary")) && (
          <Link href="/receiver/family/invite">
            <Button variant="outline" size="sm">
              Invite member
            </Button>
          </Link>
        )}
      </header>

      {invited === "1" && (
        <div
          role="status"
          className="rounded-xl border border-success bg-canvas p-3 text-sm text-success"
        >
          Invitation sent successfully.
        </div>
      )}

      {!circle ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="font-heading text-lg font-semibold text-ink">
            No care circle yet
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Invite a family member to automatically create your care circle.
          </p>
          <Link href="/receiver/family/invite" className="mt-4 inline-block">
            <Button>Invite a family member</Button>
          </Link>
        </div>
      ) : (
        <>
          {members.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              <h2 className="font-heading text-lg font-semibold text-ink">
                No members yet
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                Invite family members to join your care circle.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          member.role === "primary"
                            ? "border-brand text-brand"
                            : "border-border text-ink-muted"
                        }`}
                      >
                        {member.role === "primary"
                          ? "Primary"
                          : "Member"}
                      </span>
                      <p className="truncate font-medium text-ink">
                        {member.display_name ?? "Family member"}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {member.accepted_at
                        ? `Joined ${formatDate(member.accepted_at)}`
                        : `Invited ${formatDate(member.invited_at)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/receiver/family/${member.id}`}>
                      <Button variant="outline" size="sm">
                        View
                      </Button>
                    </Link>
                    {isReceiver && (
                      <form
                        action={async () => {
                          "use server";
                          await removeMember(member.id);
                        }}
                      >
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                        >
                          Remove
                        </Button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {pendingInvites.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-heading text-lg font-semibold text-ink">
                Pending invitations
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {pendingInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {invite.email}
                      </p>
                      <p className="text-xs text-ink-muted">
                        Expires {formatDate(invite.expires_at)}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                      Pending
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
