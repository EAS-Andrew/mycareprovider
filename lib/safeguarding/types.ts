export type SafeguardingSubjectType = "provider" | "receiver" | "other";

export type SafeguardingSeverity =
  | "information"
  | "low"
  | "medium"
  | "high"
  | "immediate_risk";

export type SafeguardingStatus =
  | "submitted"
  | "triaged"
  | "investigating"
  | "escalated"
  | "resolved";

export type SafeguardingEventType =
  | "triage"
  | "assign"
  | "escalate"
  | "note"
  | "resolve";

export interface SafeguardingReportRow {
  id: string;
  reporter_id: string | null;
  reporter_role: string | null;
  subject_type: SafeguardingSubjectType;
  subject_id: string | null;
  subject_description: string | null;
  severity: SafeguardingSeverity;
  summary: string;
  details: string | null;
  status: SafeguardingStatus;
  assigned_to: string | null;
  triage_deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface SafeguardingReportEventRow {
  id: string;
  report_id: string;
  actor_id: string | null;
  event_type: SafeguardingEventType;
  details: Record<string, unknown> | null;
  created_at: string;
}

export const SEVERITY_LABELS: Record<SafeguardingSeverity, string> = {
  information: "Information",
  low: "Low",
  medium: "Medium",
  high: "High",
  immediate_risk: "Immediate risk",
};

export const STATUS_LABELS: Record<SafeguardingStatus, string> = {
  submitted: "Submitted",
  triaged: "Triaged",
  investigating: "Investigating",
  escalated: "Escalated",
  resolved: "Resolved",
};

export const EVENT_TYPE_LABELS: Record<SafeguardingEventType, string> = {
  triage: "Triage",
  assign: "Assignment",
  escalate: "Escalation",
  note: "Note",
  resolve: "Resolution",
};
