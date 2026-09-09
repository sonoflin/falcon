import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
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
  title: "FFZ Ops Review",
  description:
    "Falcon Field Airport operations review — potential procedure deviations with verifiable flight evidence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-sans)] antialiased text-stone-900 bg-stone-50">
        <header className="print:hidden border-b border-stone-200/80 bg-stone-950 text-amber-50">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 h-12 flex items-center justify-between">
            <a href="/" className="text-sm font-semibold tracking-wide">
              FFZ Ops Review
            </a>
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              America/Phoenix
            </span>
          </div>
        </header>
        {children}
        <footer className="print:hidden mt-auto border-t border-stone-200 py-6 text-center text-xs text-stone-500">
          Flight data © contributors to the OpenSky Network · City boundary © OpenStreetMap
        </footer>
      </body>
    </html>
  );
}
