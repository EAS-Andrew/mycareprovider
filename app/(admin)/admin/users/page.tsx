import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { createServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Users - Administrator",
};

type AdminProfile = {
  id: string;
  display_name: string | null;
  role: string;
};

export default async function AdminUsersPage() {
  const supabase = await createServerClient();
  const { data: admins, error } = await supabase
    .from("profiles")
    .select("id, display_name, role")
    .eq("role", "admin")
    .is("deleted_at", null)
    .order("display_name", { ascending: true });

  const rows = (admins ?? []) as AdminProfile[];

  return (
    <section className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-ink-muted">
            Current administrators. Only admins can invite new admins.
          </p>
        </div>
        <Link href="/admin/users/invite" className={buttonStyles()}>
          Invite admin
        </Link>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-md border border-danger bg-canvas p-3 text-sm text-danger"
        >
          Failed to load administrators: {error.message}
        </div>
      ) : null}

      <div className="mt-8 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Display name
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Role
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-ink-muted">
                  No administrators found.
                </td>
              </tr>
            ) : (
              rows.map((admin) => (
                <tr key={admin.id} className="border-t border-border">
                  <td className="px-4 py-3 text-ink">
                    {admin.display_name ?? "(no name)"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{admin.role}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
