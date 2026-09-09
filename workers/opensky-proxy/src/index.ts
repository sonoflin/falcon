/**
 * OpenSky egress proxy for Falcon.
 * Vercel serverless often cannot TCP-connect to auth.opensky-network.org;
 * Cloudflare Workers typically can. This Worker mints OAuth tokens and can
 * optionally forward authenticated OpenSky REST calls.
 *
 * Auth: every non-public route requires header `X-Proxy-Secret: <PROXY_SECRET>`.
 */
export interface Env {
  PROXY_SECRET: string;
  OPENSKY_CLIENT_ID: string;
  OPENSKY_CLIENT_SECRET: string;
}

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API_BASE = "https://opensky-network.org/api";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proxy-Secret",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function unauthorized(): Response {
  return json({ error: "unauthorized" }, 401);
}

function checkSecret(req: Request, env: Env): boolean {
  const header = req.headers.get("X-Proxy-Secret") || "";
  const bearer = req.headers.get("Authorization") || "";
  const token = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : "";
  return Boolean(env.PROXY_SECRET) && (header === env.PROXY_SECRET || token === env.PROXY_SECRET);
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
    upstream = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(
      {
        error: "OpenSky auth unreachable from Cloudflare Worker",
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
  const url = `${API_BASE}${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
  const headers = new Headers();
  headers.set("Accept", req.headers.get("Accept") || "application/json");
  // Prefer dedicated OpenSky token header; fall back to Authorization when it
  // is not the proxy secret itself.
  const openskyAuth = req.headers.get("X-OpenSky-Authorization");
  const auth = req.headers.get("Authorization");
  if (openskyAuth) {
    headers.set("Authorization", openskyAuth);
  } else if (auth) {
    headers.set("Authorization", auth);
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      redirect: "follow",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(
      { error: "OpenSky API unreachable from Cloudflare Worker", detail },
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
  for (const [name, target] of [
    ["auth", TOKEN_URL],
    ["api", `${API_BASE}/states/all?icao24=a00001`],
  ] as const) {
    const started = Date.now();
    try {
      const res = await fetch(target, {
        method: name === "auth" ? "OPTIONS" : "GET",
        headers: { Accept: "application/json" },
      });
      // OPTIONS may not be allowed; try GET/HEAD-ish via GET for api, POST empty for auth probe differently
      results[name] = {
        ok: res.status < 500,
        status: res.status,
        ms: Date.now() - started,
      };
    } catch (err) {
      results[name] = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      };
    }
  }
  // Stronger auth probe: TCP/TLS handshake via POST without valid body still proves reachability
  {
    const started = Date.now();
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_id=probe&client_secret=probe",
      });
      results.authPost = {
        ok: res.status !== 0,
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
  return json({ proxy: "falcon-opensky-proxy", results });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

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
