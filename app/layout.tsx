import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin", "latin-ext"], // latin-ext covers õ ä ö ü š ž ā ē ī ū ļ ņ ķ ģ ą č ę ė į ų
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Biddr: performance car auctions in the Baltics", template: "%s | Biddr" },
  description:
    "Weekly auctions of BMW M, Audi RS, AMG and Porsche cars in Estonia, Latvia and Lithuania. Every restored car comes with an independent inspection report.",
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
      <body className="min-h-dvh font-sans">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
