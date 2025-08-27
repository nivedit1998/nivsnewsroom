// app/sitemap.ts
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.nivstechpulse.com";
  const now = new Date().toISOString();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    // add more pages here as you grow (e.g. /about, /blog, etc.)
  ];
}
