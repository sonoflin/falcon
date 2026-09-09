import { NextRequest, NextResponse } from "next/server";
import { buildReport } from "@/lib/report";
import { resolvePreset, type PresetId } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reportCache = new Map<string, { expires: number; body: unknown }>();
/** In-flight builds keyed by cache key — avoids duplicate concurrent pulls. */
const inflight = new Map<string, Promise<unknown>>();

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const preset = (sp.get("preset") || "staff_off") as PresetId;
    const beginParam = sp.get("begin");
    const endParam = sp.get("end");
    const window = resolvePreset(
      preset,
      beginParam ? Number(beginParam) : undefined,
      endParam ? Number(endParam) : undefined
    );

    if (
      !Number.isFinite(window.begin) ||
      !Number.isFinite(window.end) ||
      window.end <= window.begin
    ) {
      return NextResponse.json({ error: "Invalid time window" }, { status: 400 });
    }

    const cacheKey = `${preset}:${window.begin}:${window.end}`;
    const skipCache = sp.get("nocache") === "1";
    const cached = reportCache.get(cacheKey);
    if (!skipCache && cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.body);
    }

    let pending = inflight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const report = await buildReport(window.begin, window.end);
        const body = { ...report, window: { ...window } };
        reportCache.set(cacheKey, { expires: Date.now() + 120_000, body });
        return body;
      })().finally(() => {
        inflight.delete(cacheKey);
      });
      inflight.set(cacheKey, pending);
    }

    const body = await pending;
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
