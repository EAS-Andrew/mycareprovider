import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { getPendingDsarRequests } from "@/lib/admin/dsar-actions";

export const metadata = {
  title: "Data Subject Requests - Administrator",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function DsarQueuePage({ searchParams }: PageProps) {
  const { error, ok } = await searchParams;
  const requests = await getPendingDsarRequests();

  const accessRequests = requests.filter((r) => r.request_type === "access");
  const erasureRequests = requests.filter((r) => r.request_type === "erasure");

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-ink-muted underline">
          &larr; Back to admin
        </Link>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">
        Data subject requests
      </h1>
      <p className="mt-1 text-ink-muted">
        Review and process DSAR export and erasure requests within statutory
        deadlines.
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {ok ? (
        <div
          role="status"
          className="mt-4 rounded-md border border-success bg-canvas p-3 text-sm text-ink"
        >
          {ok}
        </div>
      ) : null}

      {/* Data export requests */}
      <h2 className="mt-8 text-xl font-semibold">
        Data export requests ({accessRequests.length})
      </h2>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Requester
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Requested
              </th>
              <th scope="col" className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {accessRequests.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-ink-muted">
                  No pending data export requests.
                </td>
              </tr>
            ) : (
              accessRequests.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3 text-ink">
                    {(r.requester as { display_name: string | null })
                      ?.display_name ?? "(no name)"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {new Date(r.requested_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/dsar/${r.id}`}
                      className={buttonStyles({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Erasure requests */}
      <h2 className="mt-10 text-xl font-semibold">
        Erasure requests ({erasureRequests.length})
      </h2>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Requester
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Requested
              </th>
              <th scope="col" className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {erasureRequests.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-ink-muted">
                  No pending erasure requests.
                </td>
              </tr>
            ) : (
              erasureRequests.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3 text-ink">
                    {(r.requester as { display_name: string | null })
                      ?.display_name ?? "(no name)"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {new Date(r.requested_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/dsar/${r.id}`}
                      className={buttonStyles({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
