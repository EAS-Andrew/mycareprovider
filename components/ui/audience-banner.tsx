import { HeartHandshake, ShieldCheck, Stethoscope } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Audience = "receiver" | "provider" | "admin";

const LABELS: Record<Audience, { label: string; icon: LucideIcon }> = {
  receiver: { label: "Care receiver", icon: HeartHandshake },
  provider: { label: "Care provider", icon: Stethoscope },
  admin: { label: "Administrator", icon: ShieldCheck },
};

/*
 * Persistent audience label. Required on every themed surface so that users
 * who cannot perceive brand color (colorblind, screen reader, high-contrast)
 * still know which side of the platform they are on. WCAG 2.1 SC 1.4.1.
 */
export function AudienceBanner({ audience }: { audience: Audience }) {
  const { label, icon: Icon } = LABELS[audience];
  return (
    <div
      role="status"
      aria-label={`You are on the ${label.toLowerCase()} side of MyCareProvider`}
      className="flex items-center gap-2 border-b border-border bg-surface px-6 py-3 text-sm font-medium text-ink"
    >
      <Icon aria-hidden className="size-5 text-brand" />
      <span>{label}</span>
    </div>
  );
}
