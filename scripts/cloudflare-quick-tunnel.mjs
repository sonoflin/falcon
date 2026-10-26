#!/usr/bin/env node
/**
 * Protected Cloudflare Quick Tunnel for the local Next.js UI only.
 *
 * October 2, 2026: cloudflared 2026.9.3+ can require an email one-time PIN
 * (--allowed-mail) before a trycloudflare.com URL reaches the origin.
 * https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
 *
 * This script always sets that flag. It does not publish the OpenSky proxy:
 * PIN login is an interactive browser session, and Vercel cannot complete it.
 * Unprotected `cloudflared tunnel --url` is rejected for the same reason the
 * staff UI should not be world-readable to anyone who sees the hostname.
 *
 * cloudflared 2026.10.4 still has https://github.com/cloudflare/cloudflared/issues/1752
 * (PIN sessions can expire after a few seconds). The notice below says so.
 * Do not widen this app's content security policy to login.trycloudflare.com.
 */
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** First release Cloudflare documents as supporting --allowed-mail. */
export const MIN_CLOUDFLARED_VERSION = [2026, 9, 3];

/**
 * Ports this repo has used for the OpenSky proxy. A Quick Tunnel must not
 * publish them: 8787 is the proxy default, 8791 is the old laptop-tunnel port.
 */
export const OPENSKY_PROXY_PORTS = new Set([8787, 8791]);

const MAX_MAIL_RULES = 100;
const MAX_MAIL_RULE_BYTES = 320;
const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const LOCAL_PART_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

export function parseCloudflaredVersion(text) {
  const match = String(text).match(/\b(\d{4})\.(\d{1,2})\.(\d{1,2})\b/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionAtLeast(version, minimum) {
  if (!version || version.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) {
    if (version[i] > minimum[i]) return true;
    if (version[i] < minimum[i]) return false;
  }
  return true;
}

function isAsciiDomain(domain) {
  return (
    domain.length > 0 &&
    domain.length <= 253 &&
    DOMAIN_PATTERN.test(domain)
  );
}

function classifyMailRule(entry) {
  if (entry.startsWith("*@")) {
    const domain = entry.slice(2);
    if (!isAsciiDomain(domain)) {
      return { error: "has an invalid wildcard domain" };
    }
    return { kind: "domain", value: `*@${domain}` };
  }
  const at = entry.indexOf("@");
  if (at <= 0 || at !== entry.lastIndexOf("@")) {
    return { error: "is not a valid email address" };
  }
  const local = entry.slice(0, at);
  const domain = entry.slice(at + 1);
  if (
    !LOCAL_PART_PATTERN.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !isAsciiDomain(domain)
  ) {
    return { error: "is not a valid email address" };
  }
  return { kind: "address", value: entry };
}

/**
 * Parse TUNNEL_ALLOWED_MAIL the way cloudflared validates --allowed-mail:
 * comma-separated exact addresses and *@domain rules, max 100, max 320 bytes
 * each, ASCII only (IDNs must already be punycode).
 */
export function parseAllowedMail(raw) {
  const source = raw == null ? "" : String(raw);
  if (!source.trim()) {
    throw new Error(
      "Set TUNNEL_ALLOWED_MAIL to the visitor's email (or '*@example.com'). Unprotected Quick Tunnels are not started: anyone with the trycloudflare.com URL could open the staff tool."
    );
  }

  const parts = source.split(",");
  if (parts.length > MAX_MAIL_RULES) {
    throw new Error(
      `TUNNEL_ALLOWED_MAIL exceeds the ${MAX_MAIL_RULES}-entry limit`
    );
  }

  /** @type {string[]} */
  const rules = [];
  const seen = new Set();
  let addressCount = 0;
  let domainCount = 0;

  parts.forEach((rawEntry, index) => {
    const position = index + 1;
    if (Buffer.byteLength(rawEntry, "utf8") > MAX_MAIL_RULE_BYTES) {
      throw new Error(
        `allowed mail rule ${position} exceeds the ${MAX_MAIL_RULE_BYTES}-byte limit`
      );
    }
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) {
      throw new Error(`allowed mail rule ${position} is empty`);
    }
    const classified = classifyMailRule(entry);
    if (classified.error) {
      throw new Error(`allowed mail rule ${position} ${classified.error}`);
    }
    if (seen.has(classified.value)) return;
    seen.add(classified.value);
    rules.push(classified.value);
    if (classified.kind === "domain") domainCount += 1;
    else addressCount += 1;
  });

  return { rules, addressCount, domainCount };
}

export function resolveTunnelOrigin(env) {
  const originRaw = env.TUNNEL_ORIGIN?.trim() || "";
  const portRaw = env.TUNNEL_PORT?.trim() || "";
  if (originRaw && portRaw) {
    throw new Error("Set TUNNEL_ORIGIN or TUNNEL_PORT, not both.");
  }

  let origin = "http://127.0.0.1:3000";
  if (portRaw) {
    if (!/^\d+$/.test(portRaw)) {
      throw new Error("TUNNEL_PORT must be an integer port.");
    }
    const port = Number(portRaw);
    if (port < 1 || port > 65535) {
      throw new Error("TUNNEL_PORT must be an integer port.");
    }
    origin = `http://127.0.0.1:${port}`;
  } else if (originRaw) {
    origin = originRaw;
  }

  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("TUNNEL_ORIGIN is not a valid URL.");
  }
  if (url.protocol !== "http:") {
    throw new Error("Quick Tunnel origin must be http on loopback.");
  }
  if (url.username || url.password) {
    throw new Error("Quick Tunnel origin must not include credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Quick Tunnel origin must be the site root, with no path or query.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Quick Tunnel origin must be a loopback address.");
  }
  if (!url.port) {
    throw new Error("Quick Tunnel origin must include the Next.js port.");
  }
  const port = Number(url.port);
  if (OPENSKY_PROXY_PORTS.has(port)) {
    throw new Error(
      `Refusing to publish port ${port}. That port is the OpenSky proxy. Protected Quick Tunnels require a browser one-time PIN and do not support non-interactive clients such as Vercel. Keep OpenSky on OPENSKY_EGRESS_PROXY_* (or a dedicated host) and tunnel only the Next.js UI.`
    );
  }
  return `http://127.0.0.1:${port}`;
}

export function buildCloudflaredArgs(origin, rules) {
  const args = ["tunnel", "--url", origin];
  for (const rule of rules) {
    args.push("--allowed-mail", rule);
  }
  return args;
}

export function recipientSummary(addressCount, domainCount) {
  const parts = [];
  if (addressCount === 1) parts.push("1 address");
  else if (addressCount > 1) parts.push(`${addressCount} addresses`);
  if (domainCount === 1) parts.push("1 domain rule");
  else if (domainCount > 1) parts.push(`${domainCount} domain rules`);
  return parts.join(", ");
}

export function protectedTunnelNotice({ origin, addressCount, domainCount }) {
  return [
    "Protected Quick Tunnel for the local Next.js UI.",
    `Origin: ${origin}`,
    `Allowed recipients: ${recipientSummary(addressCount, domainCount)}`,
    "The OpenSky proxy is not published. Email PIN login is browser-only; Vercel cannot complete it.",
    "cloudflared 2026.10.4 has not fixed https://github.com/cloudflare/cloudflared/issues/1752: the PIN session can expire after a few seconds, and later requests redirect to login.trycloudflare.com.",
    "This app's content security policy stays script-src 'self' and style-src 'self'. Do not add login.trycloudflare.com to the content security policy. Use the Vercel URL if the preview bounces back to the PIN page.",
  ].join("\n");
}

export function planTunnel(env) {
  const mail = parseAllowedMail(env.TUNNEL_ALLOWED_MAIL);
  const origin = resolveTunnelOrigin(env);
  const args = buildCloudflaredArgs(origin, mail.rules);
  return {
    origin,
    args,
    addressCount: mail.addressCount,
    domainCount: mail.domainCount,
    notice: protectedTunnelNotice({
      origin,
      addressCount: mail.addressCount,
      domainCount: mail.domainCount,
    }),
  };
}

function readCloudflaredVersion(bin) {
  const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (result.error && result.error.code === "ENOENT") {
    throw new Error(
      `cloudflared was not found (${bin}). Install 2026.9.3 or newer: https://developers.cloudflare.com/tunnel/downloads/`
    );
  }
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || ""}`.trim();
    throw new Error(
      detail
        ? `cloudflared --version failed: ${detail.slice(0, 300)}`
        : "cloudflared --version failed."
    );
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function assertCloudflaredVersion(bin) {
  const text = readCloudflaredVersion(bin);
  const version = parseCloudflaredVersion(text);
  if (!isVersionAtLeast(version, MIN_CLOUDFLARED_VERSION)) {
    const found = version ? version.join(".") : "an unrecognized build";
    throw new Error(
      `cloudflared ${found} is too old for --allowed-mail. Install 2026.9.3 or newer: https://developers.cloudflare.com/tunnel/downloads/`
    );
  }
  return version.join(".");
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const plan = planTunnel(process.env);
  const bin = process.env.CLOUDFLARED_BIN?.trim() || "cloudflared";

  if (dryRun) {
    process.stdout.write(`${plan.notice}\n`);
    process.stdout.write(`${bin} ${plan.args.join(" ")}\n`);
    return;
  }

  const version = assertCloudflaredVersion(bin);
  process.stderr.write(`${plan.notice}\ncloudflared: ${version}\n`);

  const child = spawn(bin, plan.args, { stdio: "inherit" });
  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      process.stderr.write(
        `cloudflared was not found (${bin}). Install 2026.9.3 or newer: https://developers.cloudflare.com/tunnel/downloads/\n`
      );
    } else {
      process.stderr.write(`${err.message}\n`);
    }
    process.exit(1);
  });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}

const isDirectRun = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
);

if (isDirectRun) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
