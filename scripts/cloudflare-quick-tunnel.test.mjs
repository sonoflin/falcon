import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  MIN_CLOUDFLARED_VERSION,
  buildCloudflaredArgs,
  isVersionAtLeast,
  parseAllowedMail,
  parseCloudflaredVersion,
  planTunnel,
  resolveTunnelOrigin,
} from "./cloudflare-quick-tunnel.mjs";

describe("cloudflared version", () => {
  it("parses the version banner", () => {
    assert.deepEqual(
      parseCloudflaredVersion(
        "cloudflared version 2026.10.4 (built 2026-10-23-1200 UTC)\n"
      ),
      [2026, 10, 4]
    );
  });

  it("requires 2026.9.3, the documented --allowed-mail release", () => {
    assert.equal(
      isVersionAtLeast([2026, 9, 2], MIN_CLOUDFLARED_VERSION),
      false
    );
    assert.equal(
      isVersionAtLeast([2026, 9, 3], MIN_CLOUDFLARED_VERSION),
      true
    );
    assert.equal(
      isVersionAtLeast([2026, 10, 4], MIN_CLOUDFLARED_VERSION),
      true
    );
    assert.equal(isVersionAtLeast(null, MIN_CLOUDFLARED_VERSION), false);
  });
});

describe("allowed mail", () => {
  it("normalizes addresses and domain rules", () => {
    const parsed = parseAllowedMail(
      " Alice@Example.COM , *@City.Example , bob@example.com "
    );
    assert.deepEqual(parsed.rules, [
      "alice@example.com",
      "*@city.example",
      "bob@example.com",
    ]);
    assert.equal(parsed.addressCount, 2);
    assert.equal(parsed.domainCount, 1);
  });

  it("collapses duplicates without hiding an over-long list", () => {
    const parsed = parseAllowedMail("a@example.com,A@Example.com");
    assert.deepEqual(parsed.rules, ["a@example.com"]);
    const tooMany = Array.from({ length: 101 }, () => "a@example.com").join(",");
    assert.throws(() => parseAllowedMail(tooMany), /100-entry limit/);
  });

  it("rejects empty, display-name, wildcard, and non-ASCII rules", () => {
    assert.throws(() => parseAllowedMail(""), /TUNNEL_ALLOWED_MAIL/);
    assert.throws(() => parseAllowedMail("a@example.com,"), /empty/);
    assert.throws(
      () => parseAllowedMail("Staff <a@example.com>"),
      /not a valid email address/
    );
    assert.throws(
      () => parseAllowedMail("*@*.example.com"),
      /invalid wildcard domain/
    );
    assert.throws(() => parseAllowedMail("á@example.com"), /not a valid email/);
  });

  it("enforces the 320-byte rule limit before trimming", () => {
    const local = "a".repeat(321);
    assert.throws(
      () => parseAllowedMail(`${local}@example.com`),
      /320-byte limit/
    );
    assert.doesNotThrow(() =>
      parseAllowedMail(`${" ".repeat(10)}${"a".repeat(20)}@example.com`)
    );
  });
});

describe("origin", () => {
  it("defaults to the Next.js dev server", () => {
    assert.equal(resolveTunnelOrigin({}), "http://127.0.0.1:3000");
    assert.equal(
      resolveTunnelOrigin({ TUNNEL_PORT: "3001" }),
      "http://127.0.0.1:3001"
    );
    assert.equal(
      resolveTunnelOrigin({ TUNNEL_ORIGIN: "http://localhost:3000" }),
      "http://127.0.0.1:3000"
    );
  });

  it("refuses the OpenSky proxy ports and non-loopback origins", () => {
    assert.throws(
      () => resolveTunnelOrigin({ TUNNEL_PORT: "8787" }),
      /OpenSky proxy/
    );
    assert.throws(
      () => resolveTunnelOrigin({ TUNNEL_ORIGIN: "http://127.0.0.1:8791" }),
      /OpenSky proxy/
    );
    assert.throws(
      () => resolveTunnelOrigin({ TUNNEL_ORIGIN: "https://127.0.0.1:3000" }),
      /http on loopback/
    );
    assert.throws(
      () =>
        resolveTunnelOrigin({
          TUNNEL_ORIGIN: "http://demo.example.com:3000",
        }),
      /loopback/
    );
    assert.throws(
      () =>
        resolveTunnelOrigin({
          TUNNEL_ORIGIN: "http://user:pass@127.0.0.1:3000",
        }),
      /credentials/
    );
    assert.throws(
      () => resolveTunnelOrigin({ TUNNEL_PORT: "3000", TUNNEL_ORIGIN: "http://127.0.0.1:3000" }),
      /not both/
    );
  });
});

describe("cloudflared argv", () => {
  it("always passes --allowed-mail and only the UI origin", () => {
    const plan = planTunnel({
      TUNNEL_ALLOWED_MAIL: "colleague@example.com,*@falcon.example",
    });
    assert.deepEqual(plan.args, [
      "tunnel",
      "--url",
      "http://127.0.0.1:3000",
      "--allowed-mail",
      "colleague@example.com",
      "--allowed-mail",
      "*@falcon.example",
    ]);
    assert.match(plan.notice, /issues\/1752/);
    assert.match(plan.notice, /Do not add login\.trycloudflare\.com/);
    assert.match(plan.notice, /OpenSky proxy is not published/);
    assert.equal(plan.args.includes("8787"), false);
    assert.deepEqual(
      buildCloudflaredArgs("http://127.0.0.1:3000", ["a@example.com"]),
      ["tunnel", "--url", "http://127.0.0.1:3000", "--allowed-mail", "a@example.com"]
    );
  });
});

describe("cli", () => {
  it("dry-run prints the protected command and does not require cloudflared", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/cloudflare-quick-tunnel.mjs", "--dry-run"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TUNNEL_ALLOWED_MAIL: "colleague@example.com",
          TUNNEL_ORIGIN: "",
          TUNNEL_PORT: "",
          CLOUDFLARED_BIN: "cloudflared-not-installed",
        },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /cloudflared-not-installed tunnel --url http:\/\/127\.0\.0\.1:3000 --allowed-mail colleague@example\.com/
    );
  });

  it("exits non-zero when the allowlist is missing", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/cloudflare-quick-tunnel.mjs", "--dry-run"],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TUNNEL_ALLOWED_MAIL/);
  });
});
