import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  requestDataExport,
  requestErasure,
  cancelErasure,
} from "@/lib/dsar/actions";
import { getMyDsarRequests, getMyErasureRequests } from "@/lib/dsar/queries";

export const metadata = {
  title: "Your data - Provider",
};

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

export default async function ProviderDataPage({ searchParams }: PageProps) {
  const { error, ok } = await searchParams;
  const [dsarRequests, erasureRequests] = await Promise.all([
    getMyDsarRequests(),
    getMyErasureRequests(),
  ]);

  const hasPendingExport = dsarRequests.some(
    (r) => r.request_type === "access" && r.status === "pending",
  );
  const hasPendingErasure = dsarRequests.some(
    (r) => r.request_type === "erasure" && r.status === "pending",
  );
  const activeErasure = erasureRequests.find(
    (r) => r.status === "pending_cooloff",
  );

  return (
    <section className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href="/provider"
          className="text-sm text-ink-muted underline"
        >
          &larr; Back to dashboard
        </Link>
      </div>

      <h1 className="font-heading text-3xl font-bold tracking-tight">Your data</h1>
      <p className="mt-1 text-ink-muted">
        Manage your personal data. Under UK GDPR you have the right to export
        or request deletion of your data.
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-danger bg-canvas p-3 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {ok ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-success bg-canvas p-3 text-sm text-ink"
        >
          {ok}
        </div>
      ) : null}

      {/* Data export */}
      <div className="mt-8 rounded-2xl border border-border p-5">
        <h2 className="font-heading font-semibold text-ink">Export your data</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Download a machine-readable (JSON) bundle of all your personal data
          held on the platform.
        </p>
        <form action={requestDataExport} className="mt-4">
          <Button type="submit" disabled={hasPendingExport}>
            {hasPendingExport ? "Export pending..." : "Request data export"}
          </Button>
        </form>
      </div>

      {/* Previous export downloads */}
      {dsarRequests.filter((r) => r.request_type === "access").length > 0 ? (
        <div className="mt-6">
          <h2 className="font-heading text-lg font-semibold">Export history</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Requested
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Download
                  </th>
                </tr>
              </thead>
              <tbody>
                {dsarRequests
                  .filter((r) => r.request_type === "access")
                  .map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-3 text-ink-muted">
                        {new Date(r.requested_at).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.download_url &&
                        r.download_expires_at &&
                        new Date(r.download_expires_at) > new Date() ? (
                          <a
                            href={r.download_url}
                            className="text-brand underline text-sm"
                            download
                          >
                            Download
                          </a>
                        ) : r.status === "completed" ? (
                          <span className="text-xs text-ink-muted">
                            Expired
                          </span>
                        ) : (
                          <span className="text-xs text-ink-muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Erasure */}
      <div className="mt-8 rounded-2xl border border-danger/30 p-5">
        <h2 className="font-heading font-semibold text-ink">Delete your account</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Request permanent deletion of your account and personal data. A 30-day
          cool-off period applies during which you can cancel. Some records may
          be retained under legal obligations.
        </p>

        {activeErasure ? (
          <div className="mt-4 rounded-xl border border-border bg-surface p-4">
            <p className="text-sm text-ink">
              Your erasure request is in the cool-off period. You can cancel
              before{" "}
              <strong>
                {new Date(activeErasure.cooloff_ends_at).toLocaleDateString(
                  "en-GB",
                )}
              </strong>
              .
            </p>
            <form action={cancelErasure} className="mt-3">
              <input type="hidden" name="erasureId" value={activeErasure.id} />
              <Button type="submit" variant="outline">
                Cancel erasure request
              </Button>
            </form>
          </div>
        ) : (
          <form action={requestErasure} className="mt-4">
            <Button
              type="submit"
              disabled={hasPendingErasure}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {hasPendingErasure
                ? "Erasure pending..."
                : "Request account deletion"}
            </Button>
          </form>
        )}
      </div>

      {/* Erasure history */}
      {erasureRequests.length > 0 ? (
        <div className="mt-6">
          <h2 className="font-heading text-lg font-semibold">Erasure history</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Requested
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Cool-off ends
                  </th>
                </tr>
              </thead>
              <tbody>
                {erasureRequests.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(r.created_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                        {r.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(r.cooloff_ends_at).toLocaleDateString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
