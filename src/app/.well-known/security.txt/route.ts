import { SECURITY_CONTACT, SECURITY_TXT_EXPIRES } from "@/lib/site";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const body = [
    "# FFZ Ops Review is an independent Falcon Field (KFFZ) operations tool.",
    "# It is not an official government website and does not collect credentials.",
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/about`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
