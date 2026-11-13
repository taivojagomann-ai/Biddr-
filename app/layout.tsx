import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin", "latin-ext"], // latin-ext covers õ ä ö ü š ž ā ē ī ū ļ ņ ķ ģ ą č ę ė į ų
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  // Makes Open Graph and Twitter image URLs absolute. Set NEXT_PUBLIC_SITE_URL in Vercel.
  metadataBase: new URL(siteUrl()),
  title: { default: "Biddr: performance car auctions", template: "%s | Biddr" },
  description: "Buy and sell exceptional performance cars with transparent bidding, documented service histories and independent inspections for restored cars.",
};

export const viewport: Viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${archivo.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a
          href="#content"
          className="sr-only z-50 rounded-md bg-signal px-4 py-3 font-semibold text-asphalt focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to main content
        </a>
        <SiteHeader />
        <div id="content" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
