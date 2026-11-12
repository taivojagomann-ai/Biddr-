import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import Link from "next/link";
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
        <header className="sticky top-0 z-40 border-b border-line bg-asphalt/90 backdrop-blur">
          <div className="container flex h-14 items-center justify-between">
            <Link href="/" className="font-wide text-lg font-extrabold tracking-tight">
              Biddr<span className="text-signal">.</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-2 text-mute hover:text-chalk">Auctions</Link>
              <Link href="/sell" className="rounded-md px-3 py-2 text-mute hover:text-chalk">Sell a car</Link>
              <Link href="/login" className="rounded-md border border-line px-3 py-2 hover:border-mute">Sign in</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
