import RSSParser from "rss-parser";
import { XMLParser } from "fast-xml-parser";
import {
  COMPANY_SOURCES,
  FEED_SOURCES,
  SOURCE_REGISTRY,
} from "./news-sources.mjs";

const TIMEOUT_MS = 20_000;
const parser = new RSSParser();
const xmlParser = new XMLParser({ ignoreAttributes: false });
const groups = {
  ...FEED_SOURCES,
  ...Object.fromEntries(
    Object.entries(COMPANY_SOURCES).map(([company, sources]) => ["company:" + company, sources])
  ),
};

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normaliseHostname(host) {
  return String(host || "").replace(/^www\./, "").toLowerCase();
}

function isAllowedHost(url, allowedHosts = []) {
  const host = normaliseHostname(hostnameOf(url));
  return !allowedHosts.length || allowedHosts.some(
    (allowed) => normaliseHostname(allowed) === host
  );
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NivsNewsRoomSourceCheck/1.0" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error("HTTP " + response.status);
    return { contentType: response.headers.get("content-type") || "", text };
  } finally {
    clearTimeout(timer);
  }
}

function sitemapCount(xml, source) {
  const parsed = xmlParser.parse(xml);
  const rows = Array.isArray(parsed?.urlset?.url)
    ? parsed.urlset.url
    : parsed?.urlset?.url
      ? [parsed.urlset.url]
      : [];
  const matching = rows.filter((row) => {
    const url = String(row?.loc || "").trim();
    if (!url || !isAllowedHost(url, source.allowedHosts)) return false;
    source.includePath.lastIndex = 0;
    try {
      return source.includePath.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
  return { total: rows.length, usable: matching.length };
}

async function inspectSource(source) {
  const { contentType, text } = await fetchText(source.url);
  if (source.kind === "sitemap") {
    const counts = sitemapCount(text, source);
    return { contentType, ...counts };
  }

  const feed = await parser.parseString(text);
  const usable = (feed.items || []).filter((item) => {
    const url = String(item.link || "").trim();
    return Boolean(item.title && /^https?:\/\//i.test(url) && isAllowedHost(url, source.allowedHosts));
  });
  return {
    contentType,
    total: (feed.items || []).length,
    usable: usable.length,
  };
}

const results = [];
for (const source of SOURCE_REGISTRY) {
  try {
    const inspected = await inspectSource(source);
    results.push({ ...source, ...inspected, healthy: inspected.usable > 0 });
    console.log(
      "OK " + (source.group || "company:" + source.company) + " | " +
      source.label + " | " + source.kind + " | HTTP content-type " +
      inspected.contentType + " | " + inspected.usable + "/" + inspected.total + " usable"
    );
  } catch (error) {
    results.push({
      ...source,
      total: 0,
      usable: 0,
      healthy: false,
      error: String(error?.message || error),
    });
    console.error(
      "FAIL " + (source.group || "company:" + source.company) + " | " +
      source.label + " | " + String(error?.message || error)
    );
  }
}

const failedGroups = Object.entries(groups)
  .filter(([group, sources]) => {
    const groupResults = results.filter((result) =>
      group === result.group || group === "company:" + result.company
    );
    return sources.length > 0 && !groupResults.some((result) => result.healthy);
  })
  .map(([group]) => group);

if (failedGroups.length) {
  console.error("Required source groups have no usable sources: " + failedGroups.join(", "));
  process.exit(1);
}

console.log("Source health check passed.");
