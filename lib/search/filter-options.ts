import "server-only";

import {
  listServiceCategories,
  listCapabilities,
  listCertifications,
} from "@/lib/providers/catalog";

export type FilterOption = {
  slug: string;
  name: string;
};

export type FilterOptions = {
  services: FilterOption[];
  capabilities: FilterOption[];
  certifications: FilterOption[];
  genders: FilterOption[];
};

const GENDER_OPTIONS: FilterOption[] = [
  { slug: "female", name: "Female" },
  { slug: "male", name: "Male" },
  { slug: "non_binary", name: "Non-binary" },
];

export async function getFilterOptions(): Promise<FilterOptions> {
  const [services, capabilities, certifications] = await Promise.all([
    listServiceCategories(),
    listCapabilities(),
    listCertifications(),
  ]);

  return {
    services: services.map((s) => ({ slug: s.slug, name: s.name })),
    capabilities: capabilities.map((c) => ({ slug: c.slug, name: c.name })),
    certifications: certifications.map((c) => ({ slug: c.slug, name: c.name })),
    genders: GENDER_OPTIONS,
  };
}
