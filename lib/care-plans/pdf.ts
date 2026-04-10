"use server";

import { getCurrentRole } from "@/lib/auth/current-role";
import { createServerClient } from "@/lib/supabase/server";

import type {
  CarePlanActivityRow,
  CarePlanVersionRow,
  LineItem,
} from "./types";
import {
  CARE_PLAN_STATUS_LABELS,
  FREQUENCY_LABELS,
  VERSION_STATUS_LABELS,
} from "./types";

/**
 * Story 30: Generate a care plan version as a printable HTML document.
 * Accepts recipientRole to theme accordingly:
 *   - 'receiver' -> blue header/branding
 *   - 'provider' -> purple header/branding
 */
export async function generateCarePlanPdf(
  versionId: string,
  recipientRole: "receiver" | "provider",
): Promise<string> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const role = await getCurrentRole(supabase, user);
  if (!role) throw new Error("Could not determine role");

  // Fetch version
  const { data: version, error: vErr } = await supabase
    .from("care_plan_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();

  if (vErr) throw new Error(`generateCarePlanPdf: ${vErr.message}`);
  if (!version) throw new Error("Version not found");

  const v = version as CarePlanVersionRow;

  // Fetch care plan
  const { data: plan, error: pErr } = await supabase
    .from("care_plans")
    .select("id, title, status, provider_id, receiver_id")
    .eq("id", v.care_plan_id)
    .maybeSingle();

  if (pErr) throw new Error(`generateCarePlanPdf plan: ${pErr.message}`);
  if (!plan) throw new Error("Care plan not found");

  const planRow = plan as {
    id: string;
    title: string;
    status: string;
    provider_id: string;
    receiver_id: string;
  };

  // Fetch participant names
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", [planRow.provider_id, planRow.receiver_id]);

  const nameMap = new Map<string, string>();
  for (const p of (profiles ?? []) as {
    id: string;
    display_name: string | null;
  }[]) {
    nameMap.set(p.id, p.display_name ?? "Unknown");
  }

  // Fetch activities
  const { data: activities } = await supabase
    .from("care_plan_activities")
    .select("*")
    .eq("care_plan_version_id", versionId)
    .order("sort_order", { ascending: true });

  const acts = (activities ?? []) as CarePlanActivityRow[];
  const lineItems = v.line_items as LineItem[];

  // Theme colours
  const isBlue = recipientRole === "receiver";
  const brandColor = isBlue ? "#2563eb" : "#7c3aed";
  const brandBg = isBlue ? "#eff6ff" : "#f5f3ff";
  const brandLabel = isBlue ? "MyCareProvider - Receiver Copy" : "MyCareProvider - Provider Copy";

  const formatPence = (pence: number) => {
    const pounds = (pence / 100).toFixed(2);
    return `\u00a3${pounds}`;
  };

  const activitiesHtml =
    acts.length > 0
      ? `
    <h2 style="color: ${brandColor}; margin-top: 24px;">Activities</h2>
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
      <thead>
        <tr style="background: ${brandBg};">
          <th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Activity</th>
          <th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Frequency</th>
          <th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Duration</th>
          <th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Description</th>
        </tr>
      </thead>
      <tbody>
        ${acts
          .map(
            (a) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(a.title)}</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${FREQUENCY_LABELS[a.frequency] ?? a.frequency}</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${a.duration_minutes ? `${a.duration_minutes} min` : "-"}</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${a.description ? escapeHtml(a.description) : "-"}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
      : "";

  const lineItemsHtml =
    lineItems.length > 0
      ? `
    <h2 style="color: ${brandColor}; margin-top: 24px;">Pricing</h2>
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
      <thead>
        <tr style="background: ${brandBg};">
          <th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Description</th>
          <th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Unit</th>
          <th style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">Qty</th>
          <th style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">Unit price</th>
          <th style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems
          .map(
            (item) => `
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(item.description)}</td>
            <td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(item.unit)}</td>
            <td style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">${item.quantity}</td>
            <td style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">${formatPence(item.unit_price_pence)}</td>
            <td style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">${formatPence(item.quantity * item.unit_price_pence)}</td>
          </tr>`,
          )
          .join("")}
        <tr style="background: ${brandBg}; font-weight: bold;">
          <td colspan="4" style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">Total</td>
          <td style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">${formatPence(v.total_pence)}</td>
        </tr>
      </tbody>
    </table>`
      : "";

  const consentHtml = `
    <h2 style="color: ${brandColor}; margin-top: 24px;">Visit Media Consent</h2>
    <p><strong>Consent for photo/video during visits:</strong> ${v.visit_media_consent ? "Granted" : "Not granted"}</p>
    ${v.consent_granted_by ? `<p><strong>Consent given by:</strong> ${escapeHtml(nameMap.get(v.consent_granted_by) ?? "Unknown")}</p>` : ""}
    ${v.consent_granted_at ? `<p><strong>Consent date:</strong> ${new Date(v.consent_granted_at).toLocaleDateString("en-GB")}</p>` : ""}
  `;

  const approvalHtml = v.approved_by
    ? `
    <h2 style="color: ${brandColor}; margin-top: 24px;">Approval</h2>
    <p><strong>Approved by:</strong> ${escapeHtml(nameMap.get(v.approved_by) ?? "Unknown")}</p>
    <p><strong>Approved on:</strong> ${v.approved_at ? new Date(v.approved_at).toLocaleDateString("en-GB") : "-"}</p>
  `
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(planRow.title)} - Version ${v.version_number}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #1f2937; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div style="border-bottom: 3px solid ${brandColor}; padding-bottom: 16px; margin-bottom: 24px;">
    <h1 style="color: ${brandColor}; margin: 0;">${escapeHtml(planRow.title)}</h1>
    <p style="color: #6b7280; margin: 4px 0 0;">${brandLabel}</p>
  </div>

  <table style="width: 100%; margin-bottom: 24px;">
    <tr>
      <td style="width: 50%;"><strong>Version:</strong> ${v.version_number}</td>
      <td><strong>Status:</strong> ${VERSION_STATUS_LABELS[v.status] ?? v.status}</td>
    </tr>
    <tr>
      <td><strong>Care plan status:</strong> ${CARE_PLAN_STATUS_LABELS[planRow.status as keyof typeof CARE_PLAN_STATUS_LABELS] ?? planRow.status}</td>
      <td><strong>Created:</strong> ${new Date(v.created_at).toLocaleDateString("en-GB")}</td>
    </tr>
    <tr>
      <td><strong>Provider:</strong> ${escapeHtml(nameMap.get(planRow.provider_id) ?? "Unknown")}</td>
      <td><strong>Receiver:</strong> ${escapeHtml(nameMap.get(planRow.receiver_id) ?? "Unknown")}</td>
    </tr>
  </table>

  ${v.notes ? `<p><strong>Notes:</strong> ${escapeHtml(v.notes)}</p>` : ""}

  ${activitiesHtml}
  ${lineItemsHtml}
  ${consentHtml}
  ${approvalHtml}

  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
    <p>Generated on ${new Date().toLocaleDateString("en-GB")} by MyCareProvider</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
