export function getPublicSiteUrl(req?: Request) {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  if (!req) {
    throw new Error("Missing required environment variable: PUBLIC_SITE_URL");
  }

  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "https";
  return `${proto}://${host}`.replace(/\/+$/, "");
}
