export type CarePlanStatus =
  | "draft"
  | "pending_approval"
  | "active"
  | "paused"
  | "completed"
  | "cancelled";

export type CarePlanVersionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected";

export type ActivityFrequency =
  | "daily"
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "as_needed";

export interface LineItem {
  description: string;
  unit: string;
  quantity: number;
  unit_price_pence: number;
  notes?: string;
}

export interface CarePlanRow {
  id: string;
  provider_id: string;
  receiver_id: string;
  title: string;
  status: CarePlanStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CarePlanVersionRow {
  id: string;
  care_plan_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  line_items: LineItem[];
  total_pence: number;
  visit_media_consent: boolean;
  consent_granted_by: string | null;
  consent_granted_at: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  status: CarePlanVersionStatus;
  notes: string | null;
  created_at: string;
}

export interface CarePlanActivityRow {
  id: string;
  care_plan_version_id: string;
  title: string;
  description: string | null;
  frequency: ActivityFrequency;
  duration_minutes: number | null;
  sort_order: number;
  created_at: string;
}

export interface CarePlanWithParticipants extends CarePlanRow {
  provider_name: string | null;
  receiver_name: string | null;
}

export const CARE_PLAN_STATUS_LABELS: Record<CarePlanStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const VERSION_STATUS_LABELS: Record<CarePlanVersionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

export const FREQUENCY_LABELS: Record<ActivityFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  as_needed: "As needed",
};
