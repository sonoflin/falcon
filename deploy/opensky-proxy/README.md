# Deploy notes for a dedicated OpenSky proxy (Railway / Fly / Render / Cloud Run).
# Prefer Vercel + OPENSKY_EGRESS_PROXY_* when a CONNECT egress provider is available —
# that avoids a public proxy surface entirely.
#
# Required secrets (never commit):
#   PROXY_SECRET (>=24 chars), OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET
# Optional if the host cannot reach OpenSky natively:
#   OPENSKY_EGRESS_PROXY_HOST/PORT/USER/PASS
#
# Health: GET /health (no secrets). Probe: GET /probe (reachability only).
# Proxied: POST /token, GET /api/... — require X-Proxy-Secret.
#
# Do not put this service behind a Cloudflare Quick Tunnel. --allowed-mail
# (cloudflared 2026.9.3+) is an interactive browser PIN and Vercel cannot
# complete it. An unprotected trycloudflare.com URL is not a production path.
