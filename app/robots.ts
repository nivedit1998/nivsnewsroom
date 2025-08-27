// app/robots.ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = "https://www.nivstechpulse.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // keep internal-only APIs hidden from crawlers
          "/api/run-injest",
          "/api/newsletter/unsubscribe",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
