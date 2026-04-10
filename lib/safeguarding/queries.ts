import "server-only";

import { getCurrentRole } from "@/lib/auth/current-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import type {
  SafeguardingReportRow,
  SafeguardingReportEventRow,
} from "./types";

/**
 * Reporter's own safeguarding submissions (RLS-scoped).
 */
export async function getMySafeguardingReports(): Promise<
  SafeguardingReportRow[]
> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("safeguarding_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getMySafeguardingReports: ${error.message}`);
  return (data ?? []) as SafeguardingReportRow[];
}

/**
 * Admin queue: pending reports sorted by triage deadline (most urgent first).
 */
export async function getPendingSafeguardingReports(): Promise<
  SafeguardingReportRow[]
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user ? await getCurrentRole(supabase, user) : null;
  if (role !== "admin") throw new Error("admin-required");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("safeguarding_reports")
    .select("*")
    .in("status", ["submitted", "triaged", "investigating", "escalated"])
    .order("triage_deadline", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error)
    throw new Error(`getPendingSafeguardingReports: ${error.message}`);
  return (data ?? []) as SafeguardingReportRow[];
}

/**
 * Full report with events timeline. Admin uses admin client; reporter uses
 * RLS-scoped client.
 */
export async function getSafeguardingReport(
  reportId: string,
): Promise<{
  report: SafeguardingReportRow;
  events: SafeguardingReportEventRow[];
} | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user ? await getCurrentRole(supabase, user) : null;

  const client = role === "admin" ? createAdminClient() : supabase;

  const { data: report, error: reportError } = await client
    .from("safeguarding_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError)
    throw new Error(`getSafeguardingReport: ${reportError.message}`);
  if (!report) return null;

  const { data: events, error: eventsError } = await client
    .from("safeguarding_report_events")
    .select("*")
    .eq("report_id", reportId)
    .order("created_at", { ascending: true });

  if (eventsError)
    throw new Error(`getSafeguardingReport events: ${eventsError.message}`);

  return {
    report: report as SafeguardingReportRow,
    events: (events ?? []) as SafeguardingReportEventRow[],
  };
}

/**
 * Dashboard stats for the admin safeguarding queue.
 */
export async function getSafeguardingStats(): Promise<{
  total: number;
  submitted: number;
  triaged: number;
  investigating: number;
  escalated: number;
  resolved: number;
  overdueTriage: number;
  bySeverity: Record<string, number>;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user ? await getCurrentRole(supabase, user) : null;
  if (role !== "admin") throw new Error("admin-required");

  const admin = createAdminClient();

  const { data: all, error } = await admin
    .from("safeguarding_reports")
    .select("status, severity, triage_deadline");

  if (error) throw new Error(`getSafeguardingStats: ${error.message}`);

  const rows = all ?? [];
  const now = new Date();

  const stats = {
    total: rows.length,
    submitted: 0,
    triaged: 0,
    investigating: 0,
    escalated: 0,
    resolved: 0,
    overdueTriage: 0,
    bySeverity: {} as Record<string, number>,
  };

  for (const r of rows) {
    const status = r.status as keyof typeof stats;
    if (status in stats && typeof stats[status] === "number") {
      (stats[status] as number) += 1;
    }

    const sev = r.severity as string;
    stats.bySeverity[sev] = (stats.bySeverity[sev] ?? 0) + 1;

    if (
      status === "submitted" &&
      r.triage_deadline &&
      new Date(r.triage_deadline as string) < now
    ) {
      stats.overdueTriage += 1;
    }
  }

  return stats;
}
