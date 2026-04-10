import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Outfit } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-heading",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MyCareProvider",
    template: "%s · MyCareProvider",
  },
  description:
    "A UK care marketplace connecting care receivers and families with vetted care providers.",
  applicationName: "MyCareProvider",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" className={`${instrumentSerif.variable} ${outfit.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
