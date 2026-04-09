import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyCareProvider",
    short_name: "MyCareProvider",
    description:
      "A UK care marketplace for care receivers, families, and care providers.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "en-GB",
    icons: [
      {
        src: "/brand/favicon-unified.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
