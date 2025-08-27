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
          // block internal util routes if any:
          "/api/run-injest",          // your tokened ingest trigger
          "/api/newsletter/unsubscribe", // optional to keep it private-ish
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
