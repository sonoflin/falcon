import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep categorizer crawlers off live flight APIs.
      disallow: ["/api/"],
    },
  };
}
