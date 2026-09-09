#!/usr/bin/env node
/**
 * Hardened OpenSky egress proxy (Node). Same protocol as workers/opensky-proxy.
 *
 * Security:
 * - Proxied routes require X-Proxy-Secret / Bearer — not an open relay
 * - Allowlisted OpenSky API paths only (no arbitrary URL proxy / SSRF)
 * - Optional CONNECT egress (OPENSKY_EGRESS_PROXY_*) for datacenter blocks
 * - Upstream timeouts + per-IP rate limit
 * - /health and /probe never mint tokens or expose secrets
 *
 * Env: OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET, PROXY_SECRET (or OPENSKY_PROXY_SECRET),
 *      PORT (default 8787), HOST (default 0.0.0.0 for containers; use 127.0.0.1 locally),
 *      optional CREDENTIALS_JSON, optional OPENSKY_EGRESS_PROXY_*.
 */
import http from "node:http";
import fs from "node:fs";
import { URL } from "node:url";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API_BASE = "https://opensky-network.org/api";
const UPSTREAM_TIMEOUT_MS = 20_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;

const API_ALLOWLIST = [
  /^\/flights\/(departure|arrival)(\?|$)/,
  /^\/tracks\/all(\?|$)/,
  /^\/states\/all(\?|$)/,
  /^\/metadata\/aircraft\/[a-f0-9]{6}$/i,
];

function loadCreds() {
  let clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  let clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  const credPath =
    process.env.CREDENTIALS_JSON ||
    process.env.OPENSKY_CREDENTIALS_JSON ||
    "";
  if ((!clientId || !clientSecret) && credPath && fs.existsSync(credPath)) {
    const j = JSON.parse(fs.readFileSync(credPath, "utf8"));
    clientId =
      clientId ||
      j.clientId ||
      j.client_id ||
      j.ClientId ||
      j.id ||
      undefined;
    clientSecret =
      clientSecret ||
      j.clientSecret ||
      j.client_secret ||
      j.ClientSecret ||
      j.secret ||
      undefined;
    if ((!clientId || !clientSecret) && j.oauth) {
      clientId = clientId || j.oauth.clientId || j.oauth.client_id;
      clientSecret =
        clientSecret || j.oauth.clientSecret || j.oauth.client_secret;
    }
  }
  return { clientId, clientSecret };
}

function buildEgressAgent() {
  const direct = process.env.OPENSKY_EGRESS_PROXY_URL?.trim();
  const host = process.env.OPENSKY_EGRESS_PROXY_HOST?.trim();
  const port = process.env.OPENSKY_EGRESS_PROXY_PORT?.trim() || "31112";
  const user = process.env.OPENSKY_EGRESS_PROXY_USER?.trim();
  const pass = process.env.OPENSKY_EGRESS_PROXY_PASS?.trim();
  let url = direct || null;
  if (!url && host && user && pass) {
    url = `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }
  return url ? new ProxyAgent(url) : null;
}

const { clientId, clientSecret } = loadCreds();
const PROXY_SECRET =
  process.env.PROXY_SECRET?.trim() ||
  process.env.OPENSKY_PROXY_SECRET?.trim() ||
  "";
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const egressAgent = buildEgressAgent();

if (!clientId || !clientSecret) {
  console.error(
    "Missing OpenSky credentials. Set OPENSKY_CLIENT_ID/SECRET or CREDENTIALS_JSON."
  );
  process.exit(1);
}
if (!PROXY_SECRET || PROXY_SECRET.length < 24) {
  console.error(
    "Missing or weak PROXY_SECRET / OPENSKY_PROXY_SECRET (min 24 chars)."
  );
  process.exit(1);
}

/** @type {Map<string, { reset: number, count: number }>} */
const rateBuckets = new Map();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Proxy-Secret, X-OpenSky-Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function checkSecret(req) {
  const header = req.headers["x-proxy-secret"] || "";
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  return header === PROXY_SECRET || bearer === PROXY_SECRET;
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function rateLimit(req, res) {
  const key = clientIp(req);
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.reset) {
    b = { reset: now + RATE_WINDOW_MS, count: 0 };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  if (b.count > RATE_MAX) {
    json(res, 429, { error: "rate_limited" });
    return true;
  }
  return false;
}

function apiPathAllowed(pathWithQuery) {
  return API_ALLOWLIST.some((re) => re.test(pathWithQuery));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function upstreamFetch(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const opts = { ...init, signal: ac.signal };
    if (egressAgent) opts.dispatcher = egressAgent;
    return await undiciFetch(url, opts);
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Proxy-Secret, X-OpenSky-Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      });
      return res.end();
    }

    if (rateLimit(req, res)) return;

    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json(res, 200, {
        ok: true,
        service: "falcon-opensky-proxy",
        routes: ["/token", "/api/*", "/probe"],
        egress: Boolean(egressAgent),
      });
    }

    if (path === "/probe") {
      const results = {};
      for (const [name, target, init] of [
        [
          "authPost",
          TOKEN_URL,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "grant_type=client_credentials&client_id=probe&client_secret=probe",
          },
        ],
        ["api", `${API_BASE}/states/all?icao24=a00001`, { method: "GET" }],
      ]) {
        const started = Date.now();
        try {
          const r = await upstreamFetch(target, init);
          results[name] = {
            ok: r.status < 500,
            status: r.status,
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
      return json(res, 200, { proxy: "falcon-opensky-proxy", results });
    }

    if (!checkSecret(req)) {
      return json(res, 401, { error: "unauthorized" });
    }

    if (path === "/token" && req.method === "POST") {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });
      const upstream = await upstreamFetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(text);
    }

    if (path.startsWith("/api/")) {
      const rest = path.slice("/api".length) + url.search;
      if (!apiPathAllowed(rest)) {
        return json(res, 403, { error: "path_not_allowed" });
      }
      const target = `${API_BASE}${rest}`;
      const headers = { Accept: "application/json" };
      const openskyAuth = req.headers["x-opensky-authorization"];
      const auth = req.headers.authorization;
      if (openskyAuth) headers.Authorization = String(openskyAuth);
      else if (auth && req.headers["x-proxy-secret"]) {
        headers.Authorization = String(auth);
      }
      const upstream = await upstreamFetch(target, {
        method: req.method,
        headers,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : await readBody(req),
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(buf);
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 502, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OpenSky proxy listening on http://${HOST}:${PORT}`);
  console.log(`egress=${Boolean(egressAgent)}`);
});
