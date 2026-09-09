#!/usr/bin/env node
/**
 * Local OpenSky egress proxy (same protocol as workers/opensky-proxy).
 * Use when cloud hosts (Vercel, Cloudflare Workers) cannot reach OpenSky.
 *
 *   node scripts/opensky-local-proxy.mjs
 *   npx localtunnel --port 8787
 *   # then set OPENSKY_PROXY_URL + OPENSKY_PROXY_SECRET on Vercel
 *
 * Env: OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET, PROXY_SECRET (or OPENSKY_PROXY_SECRET),
 *      PORT (default 8787). Optionally CREDENTIALS_JSON path.
 */
import http from "node:http";
import fs from "node:fs";
import { URL } from "node:url";

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API_BASE = "https://opensky-network.org/api";

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
    // OpenSky download format sometimes nests under oauth
    if ((!clientId || !clientSecret) && j.oauth) {
      clientId = clientId || j.oauth.clientId || j.oauth.client_id;
      clientSecret =
        clientSecret || j.oauth.clientSecret || j.oauth.client_secret;
    }
  }
  return { clientId, clientSecret };
}

const { clientId, clientSecret } = loadCreds();
const PROXY_SECRET =
  process.env.PROXY_SECRET?.trim() ||
  process.env.OPENSKY_PROXY_SECRET?.trim() ||
  "";
const PORT = Number(process.env.PORT || 8787);

if (!clientId || !clientSecret) {
  console.error(
    "Missing OpenSky credentials. Set OPENSKY_CLIENT_ID/SECRET or CREDENTIALS_JSON."
  );
  process.exit(1);
}
if (!PROXY_SECRET) {
  console.error("Missing PROXY_SECRET / OPENSKY_PROXY_SECRET.");
  process.exit(1);
}

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

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
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

    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json(res, 200, {
        ok: true,
        service: "falcon-opensky-local-proxy",
        routes: ["/token", "/api/*", "/probe"],
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
          const r = await fetch(target, init);
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
      return json(res, 200, { proxy: "local", results });
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
      const upstream = await fetch(TOKEN_URL, {
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
      const target = `${API_BASE}${rest}`;
      const headers = { Accept: "application/json" };
      const openskyAuth = req.headers["x-opensky-authorization"];
      const auth = req.headers.authorization;
      if (openskyAuth) headers.Authorization = String(openskyAuth);
      else if (auth) headers.Authorization = String(auth);
      const upstream = await fetch(target, {
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenSky local proxy on http://127.0.0.1:${PORT}`);
  console.log("Expose with: npx localtunnel --port", PORT);
});
