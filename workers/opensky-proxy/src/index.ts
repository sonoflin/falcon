/**
 * OpenSky egress proxy for Falcon (Cloudflare Worker).
 *
 * Security:
 * - Proxied routes require X-Proxy-Secret (or Bearer) — not an open relay
 * - Only OpenSky token URL + allowlisted /api paths (no arbitrary SSRF)
 * - Health/probe never mint tokens or return secrets
 * - Short upstream timeouts + simple in-memory rate limit
 */
export interface Env {
  PROXY_SECRET: string;
  OPENSKY_CLIENT_ID: string;
  OPENSKY_CLIENT_SECRET: string;
}

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API_BASE = "https://opensky-network.org/api";
const UPSTREAM_TIMEOUT_MS = 20_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;

/** Falcon only needs these OpenSky REST prefixes. */
const API_ALLOWLIST = [
  /^\/flights\/(departure|arrival)(\?|$)/,
  /^\/tracks\/all(\?|$)/,
  /^\/states\/all(\?|$)/,
  /^\/metadata\/aircraft\/[a-f0-9]{6}$/i,
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Proxy-Secret, X-OpenSky-Authorization",
};

type Bucket = { reset: number; count: number };
const rateBuckets = new Map<string, Bucket>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function unauthorized(): Response {
  return json({ error: "unauthorized" }, 401);
}

function clientKey(req: Request): string {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function rateLimit(req: Request): Response | null {
  const key = clientKey(req);
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.reset) {
    b = { reset: now + RATE_WINDOW_MS, count: 0 };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  if (b.count > RATE_MAX) {
    return json({ error: "rate_limited" }, 429);
  }
  return null;
}

function checkSecret(req: Request, env: Env): boolean {
  const header = req.headers.get("X-Proxy-Secret") || "";
  const bearer = req.headers.get("Authorization") || "";
  const token = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : "";
  return Boolean(env.PROXY_SECRET) && (header === env.PROXY_SECRET || token === env.PROXY_SECRET);
}

function apiPathAllowed(pathWithQuery: string): boolean {
  return API_ALLOWLIST.some((re) => re.test(pathWithQuery));
}

async function fetchUpstream(
  url: string,
  init: RequestInit
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function mintToken(env: Env): Promise<Response> {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) {
    return json({ error: "OpenSky credentials not configured on proxy" }, 500);
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.OPENSKY_CLIENT_ID,
    client_secret: env.OPENSKY_CLIENT_SECRET,
  });
  let upstream: Response;
  try {
    upstream = await fetchUpstream(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(
      {
        error: "OpenSky auth unreachable from proxy host",
        detail,
      },
      502
    );
  }
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      ...cors,
    },
  });
}

async function proxyApi(req: Request, pathWithQuery: string): Promise<Response> {
  if (!apiPathAllowed(pathWithQuery)) {
    return json({ error: "path_not_allowed" }, 403);
  }
  const url = `${API_BASE}${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
  const headers = new Headers();
  headers.set("Accept", req.headers.get("Accept") || "application/json");
  const openskyAuth = req.headers.get("X-OpenSky-Authorization");
  const auth = req.headers.get("Authorization");
  if (openskyAuth) {
    headers.set("Authorization", openskyAuth);
  } else if (auth && req.headers.get("X-Proxy-Secret")) {
    // Proxy secret is on dedicated header; Authorization is the OpenSky bearer.
    headers.set("Authorization", auth);
  }

  let upstream: Response;
  try {
    upstream = await fetchUpstream(url, {
      method: req.method,
      headers,
      redirect: "follow",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(
      { error: "OpenSky API unreachable from proxy host", detail },
      502
    );
  }
  const outHeaders = new Headers(cors);
  const ct = upstream.headers.get("Content-Type");
  if (ct) outHeaders.set("Content-Type", ct);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}

async function probe(): Promise<Response> {
  const results: Record<string, unknown> = {};
  {
    const started = Date.now();
    try {
      const res = await fetchUpstream(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_id=probe&client_secret=probe",
      });
      results.authPost = {
        ok: res.status < 500,
        status: res.status,
        ms: Date.now() - started,
        note: "401/400 means host reachable; network errors mean blocked",
      };
    } catch (err) {
      results.authPost = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      };
    }
  }
  {
    const started = Date.now();
    try {
      const res = await fetchUpstream(`${API_BASE}/states/all?icao24=a00001`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      results.api = {
        ok: res.status < 500,
        status: res.status,
        ms: Date.now() - started,
      };
    } catch (err) {
      results.api = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      };
    }
  }
  return json({ proxy: "falcon-opensky-proxy", results });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const limited = rateLimit(request);
    if (limited) return limited;

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json({
        ok: true,
        service: "falcon-opensky-proxy",
        routes: ["/token", "/api/*", "/probe"],
      });
    }

    if (path === "/probe") {
      return probe();
    }

    if (!checkSecret(request, env)) {
      return unauthorized();
    }

    if (path === "/token" && request.method === "POST") {
      return mintToken(env);
    }

    if (path.startsWith("/api/")) {
      const rest = path.slice("/api".length) + url.search;
      return proxyApi(request, rest);
    }

    return json({ error: "not found" }, 404);
  },
};
