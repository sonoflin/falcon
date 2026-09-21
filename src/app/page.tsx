import { ReportDashboard } from "@/components/ReportDashboard";

export default function HomePage() {
  return (
    <main className="flex-1">
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-90"
          style={{
            background:
              "radial-gradient(1200px 500px at 10% -10%, #fef3c7 0%, transparent 55%), radial-gradient(900px 480px at 90% 0%, #ccfbf1 0%, transparent 50%), linear-gradient(180deg, #fff7ed 0%, #f5f5f4 42%, #fafaf9 100%)",
          }}
        />
        <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-10 sm:pt-14 pb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-teal-900/80">
            Falcon Field Airport · KFFZ
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl sm:text-5xl md:text-6xl text-stone-900 tracking-tight leading-[1.05]">
            FFZ Ops Review
          </h1>
          <p className="mt-4 max-w-xl text-base sm:text-lg text-stone-600 leading-relaxed">
            Overnight and off-hours ADS-B screening for KFFZ Fly Friendly / noise
            guidance — altitudes, tracks, and verifiable evidence when staff cannot
            monitor in person. Screening flags are review candidates only.
          </p>
          <p className="mt-3 text-sm text-stone-500">
            Independent review tool. Not an official government website.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pb-16">
        <ReportDashboard />
      </div>
    </main>
  );
}
