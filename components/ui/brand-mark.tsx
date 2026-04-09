import Image from "next/image";
import type { Audience } from "./audience-banner";

type Variant = Audience | "unified";

const SRC: Record<Variant, string> = {
  receiver: "/brand/favicon-blue.svg",
  provider: "/brand/favicon-purple.svg",
  admin: "/brand/favicon-admin.svg",
  unified: "/brand/favicon-unified.svg",
};

export function BrandMark({
  variant,
  size = 40,
}: {
  variant: Variant;
  size?: number;
}) {
  return (
    <Image
      src={SRC[variant]}
      width={size}
      height={size}
      alt="MyCareProvider"
      priority
    />
  );
}
