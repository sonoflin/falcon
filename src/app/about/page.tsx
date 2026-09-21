import type { Metadata } from "next";
import Link from "next/link";
import { SECURITY_CONTACT, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "About this site",
  description:
    "What FFZ Ops Review is, what it does not do, and how a network administrator can review it.",
};

export default function AboutPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 sm:py-14">
        <p className="text-xs uppercase tracking-[0.2em] text-teal-900/80">
          Site identity
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl sm:text-5xl text-stone-900 tracking-tight leading-[1.05]">
          About {SITE_NAME}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-stone-600 leading-relaxed">
          This is an independent tool for reviewing public flight tracks near
          Falcon Field Airport (KFFZ). It is not an official government website.
        </p>

        <section className="mt-10 space-y-3" aria-labelledby="what-this-is">
          <h2
            id="what-this-is"
            className="text-lg font-semibold text-stone-900"
          >
            What this site is
          </h2>
          <p className="text-sm sm:text-base text-stone-700 leading-relaxed">
            Staff can pick a time window and review altitudes and tracks against
            Falcon Field’s published voluntary noise guidance. Flags are review
            candidates with timestamps and positions. They are not citations,
            violations, or enforcement actions.
          </p>
        </section>

        <section className="mt-8 space-y-3" aria-labelledby="what-this-is-not">
          <h2
            id="what-this-is-not"
            className="text-lg font-semibold text-stone-900"
          >
            What this site is not
          </h2>
          <ul className="list-disc pl-5 space-y-2 text-sm sm:text-base text-stone-700 leading-relaxed">
            <li>Not operated by, affiliated with, or endorsed by any city or government agency.</li>
            <li>Not a login portal. It does not ask for passwords, employee credentials, or payment cards.</li>
            <li>Not a download. It does not install software or browser extensions.</li>
            <li>Not a regulatory system. Procedures shown here are voluntary.</li>
          </ul>
        </section>

        <section className="mt-8 space-y-3" aria-labelledby="data-sources">
          <h2
            id="data-sources"
            className="text-lg font-semibold text-stone-900"
          >
            Data
          </h2>
          <p className="text-sm sm:text-base text-stone-700 leading-relaxed">
            Flight lists and tracks come from the{" "}
            <a
              className="text-teal-900 underline underline-offset-2 hover:text-teal-800"
              href="https://opensky-network.org/"
            >
              OpenSky Network
            </a>{" "}
            and{" "}
            <a
              className="text-teal-900 underline underline-offset-2 hover:text-teal-800"
              href="https://adsb.lol/"
            >
              ADS-B.lol
            </a>
            . The map and the city-limits polygon used for screening come from{" "}
            <a
              className="text-teal-900 underline underline-offset-2 hover:text-teal-800"
              href="https://www.openstreetmap.org/copyright"
            >
              OpenStreetMap
            </a>
            . The site does not run third-party advertising or analytics.
          </p>
        </section>

        <section
          className="mt-8 border border-teal-900/20 bg-teal-950/[0.04] px-4 py-4 sm:px-5 space-y-3"
          aria-labelledby="network-review"
        >
          <h2
            id="network-review"
            className="text-lg font-semibold text-stone-900"
          >
            For network administrators
          </h2>
          <p className="text-sm sm:text-base text-stone-700 leading-relaxed">
            Web filters often block a host because the name is new or unusual
            (preview URLs, <span className="font-mono text-[0.92em]">*.vercel.app</span>,
            tunnel domains) or because the page looked like a municipal site.
            This application cannot change a vendor’s category. An administrator
            allowlists or recategorizes the exact hostname in the filter.
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm sm:text-base text-stone-700 leading-relaxed">
            <li>
              Suggested category: aviation, reference, or information technology.
              This host is not a government site.
            </li>
            <li>
              A stable hostname that has been reviewed once is more reliable than
              a one-off preview URL.
            </li>
            <li>
              Security contact and policy:{" "}
              <a
                className="text-teal-900 underline underline-offset-2 hover:text-teal-800"
                href="/.well-known/security.txt"
              >
                /.well-known/security.txt
              </a>{" "}
              (RFC 9116). Contact:{" "}
              <a
                className="text-teal-900 underline underline-offset-2 hover:text-teal-800 break-all"
                href={SECURITY_CONTACT}
              >
                {SECURITY_CONTACT}
              </a>
              .
            </li>
            <li>
              Responses set HTTPS enforcement, a content security policy,
              <span className="font-mono text-[0.92em]"> nosniff</span>, frame
              denial, and a locked-down permissions policy. The server does not
              send <span className="font-mono text-[0.92em]">X-Powered-By</span>.
            </li>
          </ul>
        </section>

        <p className="mt-10 text-sm">
          <Link href="/" className="text-teal-900 underline underline-offset-2 hover:text-teal-800">
            ← Back to the report
          </Link>
        </p>
      </div>
    </main>
  );
}
