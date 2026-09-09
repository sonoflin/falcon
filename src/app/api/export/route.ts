import { NextRequest, NextResponse } from "next/server";
import { buildReport, flightsToCsv } from "@/lib/report";
import { resolvePreset, type PresetId } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const preset = (sp.get("preset") || "staff_off") as PresetId;
    const format = sp.get("format") || "csv";
    const window = resolvePreset(
      preset,
      sp.get("begin") ? Number(sp.get("begin")) : undefined,
      sp.get("end") ? Number(sp.get("end")) : undefined
    );
    const report = await buildReport(window.begin, window.end);

    if (format === "json") {
      return NextResponse.json(report);
    }

    const csv = flightsToCsv(report.flights);
    const filename = `ffz-ops-review-${window.begin}-${window.end}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
