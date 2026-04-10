/**
 * C6b receiver profile types. Non-async exports so "use server" modules
 * can import without violating the use-server export rules.
 */

export type MobilityLevel =
  | "fully_mobile"
  | "limited_mobility"
  | "wheelchair_user"
  | "bed_bound";

export const MOBILITY_LEVEL_LABELS: Record<MobilityLevel, string> = {
  fully_mobile: "Fully mobile",
  limited_mobility: "Limited mobility",
  wheelchair_user: "Wheelchair user",
  bed_bound: "Bed-bound",
};

export type ReceiverProfileRow = {
  id: string;
  care_needs_summary: string | null;
  preferred_gender: string | null;
  preferred_schedule: string | null;
  mobility_level: MobilityLevel | null;
  communication_needs: string | null;
  dietary_requirements: string | null;
  medical_conditions_summary: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
