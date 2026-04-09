/**
 * Non-async exports for the providers module. `lib/providers/actions.ts` is
 * a `"use server"` file, so type aliases live here to avoid the Next.js
 * restriction that use-server modules only export async functions.
 */

export type ProviderProfileRow = {
  id: string;
  headline: string | null;
  bio: string | null;
  date_of_birth: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  country: string;
  years_experience: number | null;
  hourly_rate_pence: number | null;
  service_postcode: string | null;
  service_radius_km: number | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
