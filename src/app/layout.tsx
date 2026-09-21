import type { Metadata } from "next";
import Link from "next/link";
import { DM_Sans, Fraunces } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    type: "website",
    siteName: SITE_NAME,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-sans)] antialiased text-stone-900 bg-stone-50">
        <header className="print:hidden border-b border-stone-200/80 bg-stone-950 text-amber-50">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 min-h-12 py-2 flex items-center justify-between gap-3">
            <Link href="/" className="text-sm font-semibold tracking-wide">
              {SITE_NAME}
            </Link>
            <span className="text-[11px] uppercase tracking-wider text-stone-400 text-right">
              <span className="sm:hidden">Independent</span>
              <span className="hidden sm:inline">Independent · America/Phoenix</span>
            </span>
          </div>
        </header>
        {children}
        <footer className="print:hidden mt-auto border-t border-stone-200 py-6 text-center text-xs text-stone-500">
          <p>Independent Falcon Field (KFFZ) review tool. Not an official government website.</p>
          <p className="mt-2">
            <Link href="/about" className="underline underline-offset-2 hover:text-stone-700">
              About this site
            </Link>
            {" · "}
            <a
              href="/.well-known/security.txt"
              className="underline underline-offset-2 hover:text-stone-700"
            >
              Security contact
            </a>
          </p>
          <p className="mt-2">
            Flight data © OpenSky Network contributors · Map and boundary data © OpenStreetMap
            contributors
          </p>
        </footer>
      </body>
    </html>
  );
}
