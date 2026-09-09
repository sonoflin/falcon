/**
 * Optional HTTP(S) CONNECT egress for OpenSky when the host (e.g. Vercel)
 * cannot TCP-connect to auth.opensky-network.org / opensky-network.org.
 *
 * Not a public relay — used only by server-side OpenSky calls to allowlisted hosts.
 * Secrets must never be logged or returned to the browser.
 */
import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciInit } from "undici";

const ALLOWED_HOSTS = new Set([
  "auth.opensky-network.org",
  "opensky-network.org",
]);

let agent: ProxyAgent | null | undefined;

function buildProxyUrlFromParts(): string | null {
  const host = process.env.OPENSKY_EGRESS_PROXY_HOST?.trim();
  const port = process.env.OPENSKY_EGRESS_PROXY_PORT?.trim() || "31112";
  const user = process.env.OPENSKY_EGRESS_PROXY_USER?.trim();
  const pass = process.env.OPENSKY_EGRESS_PROXY_PASS?.trim();
  if (!host || !user || !pass) return null;
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

/** Full proxy URL (http://user:pass@host:port) — prefer split vars above. */
function getConfiguredProxyUrl(): string | null {
  const direct = process.env.OPENSKY_EGRESS_PROXY_URL?.trim();
  if (direct) {
    try {
      const u = new URL(direct);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (!u.hostname) return null;
      return direct;
    } catch {
      return null;
    }
  }
  return buildProxyUrlFromParts();
}

export function hasOpenskyEgressProxy(): boolean {
  return getConfiguredProxyUrl() != null;
}

function getAgent(): ProxyAgent | null {
  if (agent !== undefined) return agent;
  const url = getConfiguredProxyUrl();
  agent = url ? new ProxyAgent(url) : null;
  return agent;
}

function assertAllowedOpenSkyUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("OpenSky egress rejected invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("OpenSky egress requires HTTPS targets only");
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`OpenSky egress blocked host: ${parsed.hostname}`);
  }
}

/**
 * fetch() for OpenSky URLs. When egress proxy env is set, routes via CONNECT;
 * otherwise uses global fetch (same as before).
 */
export async function openskyEgressFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  assertAllowedOpenSkyUrl(url);
  const dispatcher = getAgent();
  if (!dispatcher) {
    return fetch(url, init);
  }

  const undiciInit: UndiciInit = {
    method: init?.method,
    headers: init?.headers as UndiciInit["headers"],
    body: init?.body as UndiciInit["body"],
    redirect: (init?.redirect as UndiciInit["redirect"]) || "follow",
    dispatcher,
  };

  // undici Response is compatible enough for our callers (status/text/json/arrayBuffer).
  return undiciFetch(url, undiciInit) as unknown as Response;
}
