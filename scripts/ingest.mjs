/* scripts/ingest.mjs */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import RSSParser from "rss-parser";
import { DateTime } from "luxon";
import { extract } from "@extractus/article-extractor";
import { XMLParser } from "fast-xml-parser";
import { fileURLToPath } from "node:url";
import {
  COMPANY_ALLOWED_HOSTS,
  COMPANY_KEYS,
  COMPANY_SOURCES,
  FEED_SOURCES,
  SOURCE_AUTHORITY,
  SOURCE_FALLBACKS,
  SUMMARY_LIMIT,
} from "./news-sources.mjs";

/** =========================
 *  SETTINGS
 *  ========================= */
const TIMEZONE = "Europe/London";
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "7", 10); // stays 7 by default
const TEST_MODE = process.env.TEST_MODE === "1";
const DRY_RUN = process.env.DRY_RUN === "1";
const INGEST_GROUP = String(process.env.INGEST_GROUP || "").trim().toLowerCase();
const FEED_TIMEOUT_MS = 20_000;
const FEED_RETRIES = 2;
const ARTICLE_TIMEOUT_MS = 20_000;
const ARTICLE_CONCURRENCY = 4;
const SITEMAP_ITEM_LIMIT = 30;
export const FINTECH_CONTEXT_LIMIT = 10;
export const FINTECH_SUMMARY_OUTPUT_LIMIT = 5;
export const FINTECH_LINKEDIN_LIMIT = 3;
export const FINTECH_MAX_ITEMS_PER_SOURCE = 12;
export const FINTECH_WORDS_PER_ITEM_CAP = 400;
export const INSIGHTS_SCORING_VERSION = "insights-v2";
export const GENERAL_SUMMARY_PROMPT_VERSION = "insights-v2";
export const FINTECH_SUMMARY_PROMPT_VERSION = "fintech-insights-v2";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const SUMMARY_DIR = path.join(DATA_DIR, "summaries");
const feedDiagnostics = [];
let extractionFailures = 0;
let aiSummaryCalls = 0;
let fintechAiSummaryCalls = 0;
let fintechSummaryCacheHits = 0;
const summaryContextCounts = {};
const preservedEmptySources = [];

const parser = new RSSParser({
  requestOptions: {
    headers: { "User-Agent": "NivsNewsRoomBot/1.2 (+youremail@example.com)" },
  },
});

/** =========================
 *  UK PRIORITY SIGNALS
 *  ========================= */
const UK_DOMAINS = new Set([
  "bbc.co.uk",
  "ofcom.org.uk",
  "openreach.co.uk",
  "bt.com",
  "vodafone.co.uk",
  "o2.co.uk",
  "virginmediao2.co.uk",
  "ee.co.uk",
  "three.co.uk",
  "sky.com",
  "talktalk.co.uk",
  "cityfibre.com",
  "ispreview.co.uk",
  "thinkbroadband.com",
  "theguardian.com", // UK heavy (not .co.uk)
  "finextra.com",
  "thefintechtimes.com",
  "openbanking.org.uk",
  "fca.org.uk",
]);

const UK_KEYWORDS = [
  " uk ",
  " u.k. ",
  " united kingdom",
  " britain",
  " british",
  " england",
  " scotland",
  " wales",
  " northern ireland",
  " london",
  " manchester",
  " birmingham",
  " edinburgh",
  " cardiff",
  " belfast",
  " ofcom",
  " regulator ofcom",
  " nhs",
];

const UK_TELECOM_TERMS = [
  "bt",
  "openreach",
  "vodafone uk",
  "vodafone uk’s",
  "virgin media o2",
  "vmo2",
  "o2 uk",
  "ee",
  "three uk",
  "sky",
  "talktalk",
  "cityfibre",
  "ofcom",
];

const UK_FINTECH_TERMS = [
  "open banking",
  "open finance",
  "fca",
  "psr",
  "pay.uk",
  "faster payments",
  "chaps",
  "uk payments",
  "uk fintech",
  "british fintech",
  "london",
];

export const FINTECH_INCLUDE_TERMS = [
  "fintech",
  "financial technology",
  "payments",
  "payment infrastructure",
  "digital wallet",
  "mobile payments",
  "open banking",
  "open finance",
  "embedded finance",
  "banking as a service",
  "banking-as-a-service",
  "real-time payments",
  "instant payments",
  "account-to-account",
  "neobank",
  "challenger bank",
  "digital banking",
  "lending technology",
  "buy now pay later",
  "bnpl",
  "merchant services",
  "acquiring",
  "payment orchestration",
  "fraud prevention",
  "identity verification",
  "financial crime",
  "regtech",
  "wealthtech",
  "insurtech",
  "capital markets technology",
  "stablecoin",
  "tokenisation",
  "tokenization",
  "digital assets",
  "central bank digital currency",
  "digital money",
  "ai in banking",
  "ai in payments",
];

const FINTECH_EXCLUDE_TERMS = [
  "job listing",
  "job openings",
  "careers",
  "webinar",
  "podcast",
  "unauthorised firm",
  "unauthorized firm",
  "warning list",
];

const FINTECH_CATEGORY_HOSTS = new Set([
  "finextra.com",
  "thefintechtimes.com",
  "openbanking.org.uk",
  "paymentsdive.com",
  "pymnts.com",
]);

const HIGH_TECH_TERMS = [
  "artificial intelligence",
  "ai",
  "machine learning",
  "generative ai",
  "models",
  "agents",
  "chips",
  "semiconductors",
  "processors",
  "gpus",
  "advanced packaging",
  "quantum computing",
  "robotics",
  "automation",
  "cloud computing",
  "data centres",
  "data centers",
  "software platform",
  "cybersecurity",
  "privacy",
  "identity",
  "security technology",
  "electric vehicles",
  "batteries",
  "autonomous vehicles",
  "smartphone",
  "wearables",
  "mixed reality",
  "smart home",
];

const TELECOMS_TERMS = [
  "5g",
  "6g",
  "mobile network",
  "network infrastructure",
  "telecoms",
  "telecommunications",
  "connectivity",
  "spectrum",
  "radio access network",
  "open ran",
  "core network",
  "edge computing",
  "fibre",
  "fiber",
  "broadband",
  "full fibre",
  "full fiber",
  "fixed wireless access",
  "satellite connectivity",
  "direct to device",
  "non terrestrial network",
  "wi-fi",
  "private network",
  "network api",
  "network automation",
  "internet of things",
  "iot",
  "roaming",
  "coverage",
  "capacity",
  "latency",
];

const IMPACT_STRONG_TERMS = [
  "regulation",
  "regulatory decision",
  "new rule",
  "mandate",
  "ban",
  "enforcement",
  "major compliance change",
  "outage",
  "disruption",
  "data breach",
  "cyber incident",
  "security incident",
  "safety incident",
  "service failure",
  "acquisition",
  "merger",
  "major investment",
  "market exit",
  "market entry",
  "material commercial shift",
  "national network",
  "major platform",
  "important infrastructure",
  "commercial deployment",
  "production availability",
  "breakthrough",
  "successful test",
];

const IMPACT_MEDIUM_TERMS = [
  "new product",
  "new service",
  "product launch",
  "service launch",
  "network expansion",
  "coverage expansion",
  "performance improvement",
  "price change",
  "partnership",
  "collaboration",
  "trial",
  "pilot",
  "rollout",
  "deployment",
];

const PRACTICAL_TERMS = [
  "customers",
  "consumers",
  "users",
  "businesses",
  "merchants",
  "developers",
  "operators",
  "regulators",
  "security",
  "privacy",
  "price",
  "pricing",
  "coverage",
  "speed",
  "access",
  "reliability",
  "availability",
  "capacity",
];

const NOVELTY_TERMS = [
  "launches",
  "launched",
  "introduces",
  "introduced",
  "unveils",
  "unveiled",
  "releases",
  "released",
  "deploys",
  "deployed",
  "rolls out",
  "rolled out",
  "approves",
  "approved",
  "adopts",
  "adopted",
  "requires",
  "required",
  "bans",
  "banned",
  "changes",
  "changed",
  "first",
  "milestone",
  "surpasses",
  "reaches",
  "becomes",
  "tests",
  "tested",
  "trials",
  "pilots",
  "demonstrates",
  "achieves",
  "acquires",
  "acquired",
  "merges",
  "merged",
  "expands",
  "expanded",
];

const LOW_SIGNAL_TERMS = [
  "job",
  "jobs",
  "career",
  "careers",
  "vacancy",
  "vacancies",
  "recruitment",
  "event",
  "events",
  "conference",
  "webinar",
  "podcast",
  "author",
  "tag",
  "archive",
  "category",
];

const ROUTINE_TERMS = [
  "appoints",
  "appointed",
  "names new",
  "joins forces",
  "partnership",
  "collaboration",
  "sponsorship",
  "sponsors",
  "award",
  "awards",
  "quarterly results",
  "annual results",
  "financial results",
  "earnings",
  "proud to announce",
];

const PROMOTIONAL_TERMS = [
  "world leading",
  "world-leading",
  "game changing",
  "game-changing",
  "revolutionary",
  "exciting",
  "cutting edge",
  "cutting-edge",
  "next generation",
  "next-generation",
];

function isBlockedFintechUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\/(?:event-info|events?|webinars?|podcasts?|jobs?|careers?|tags?|categories?|authors?)(?:\/|$)/i.test(pathname);
  } catch {
    return true;
  }
}

function textify(...bits) {
  return (" " + bits.filter(Boolean).join(" ").toLowerCase() + " ").replace(/\s+/g, " ");
}

function ukSignals(item, context = "general") {
  const host = (item.source || "").replace(/^www\./, "").toLowerCase();
  const maybeCoUk = host.endsWith(".co.uk");
  const domainHit = maybeCoUk || UK_DOMAINS.has(host);

  const haystack = textify(item.title, item.snippet, item.excerpt);
  const keywordHit = UK_KEYWORDS.some((kw) => haystack.includes(kw));

  let companyHit = false;
  if (context === "telecoms") {
    companyHit = UK_TELECOM_TERMS.some((kw) => haystack.includes(kw));
  } else if (context === "fintech") {
    companyHit = UK_FINTECH_TERMS.some((kw) => haystack.includes(kw));
  } else if (context.startsWith("company_")) {
    companyHit =
      haystack.includes(" accenture uk") ||
      haystack.includes(" accenture") ||
      haystack.includes(" capco") ||
      haystack.includes(" sage uk") ||
      haystack.includes(" uk ") ||
      haystack.includes(" united kingdom") ||
      haystack.includes(" london");
  }

  const wDomain = domainHit ? 0.9 : 0;
  const wKeyword = keywordHit ? 0.7 : 0;
  const wCompany = companyHit ? 0.8 : 0;

  let score = (wDomain + wKeyword + wCompany) *
    (context === "telecoms" || context === "fintech"
      ? 1.15
      : context.startsWith("company_") ? 1.1 : 1.0);

  return Math.min(score, 2.2);
}

/** =========================
 *  HELPERS
 *  ========================= */
function toISOorNull(dateStr) {
  if (!dateStr) return null;
  let d = DateTime.fromISO(dateStr);
  if (d.isValid) return d.toISO();
  d = DateTime.fromRFC2822(dateStr);
  if (d.isValid) return d.toISO();
  return null;
}

function withinWindow(iso) {
  const now = DateTime.now().setZone(TIMEZONE);
  const start = now.minus({ days: LOOKBACK_DAYS });
  if (!iso) return true;
  const d = DateTime.fromISO(iso, { zone: TIMEZONE });
  return d.isValid ? d >= start : true;
}

const sanitize = (s = "") => String(s).replace(/\s+/g, " ").trim();

function htmlToPlain(html = "") {
  let s = html
    .replace(/<(\/)?(p|div|section|article|blockquote|h[1-6]|ul|ol|li)[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n\n")
    .replace(/<(\/)?(table|thead|tbody|tr|td|th)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function firstTwoParagraphs(plain) {
  const parts = plain.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const [p1, p2] = [parts[0] || "", parts[1] || ""];
  const joined = [p1, p2].filter(Boolean).join("\n\n");
  return joined.length > 1200 ? joined.slice(0, 1200) + "…" : joined;
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = (it.url || it.title).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTitle(t = "") {
  const s = t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(the|a|an|and|of|for|to|in|on|from|with|by|at|as|is|are|was|were|will|has|have|had|this|that|into|over|under|after|before)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return s.replace(/\b(v\d+|\d+\.\d+)\b/g, "").trim();
}

function detectTopTake(title = "") {
  const t = title.toLowerCase();
  return /\b(opinion|analysis|explainer|column|editorial|interview|feature|review)\b/.test(t);
}

function normaliseScoringText(...bits) {
  return bits
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function termPattern(term) {
  const words = normaliseScoringText(term).split(" ").filter(Boolean);
  if (!words.length) return null;
  return new RegExp("\\b" + words.map((word) => word.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("\\s+") + "\\b", "i");
}

function hasScoringTerm(text, term) {
  const pattern = termPattern(term);
  return Boolean(pattern && pattern.test(text));
}

function matchingTerms(text, terms = []) {
  return terms.filter((term) => hasScoringTerm(text, term));
}

function scoringText(item) {
  return normaliseScoringText(
    item.title,
    item.snippet,
    item.excerpt,
    String(item.fullText || "").slice(0, 1800)
  );
}

function categoryTerms(context) {
  if (context === "hightech") return HIGH_TECH_TERMS;
  if (context === "telecoms") return TELECOMS_TERMS;
  if (context === "fintech") return FINTECH_INCLUDE_TERMS;
  return [];
}

function topicFitSignal(item, context, titleText, bodyText) {
  const terms = categoryTerms(context);
  if (context.startsWith("company_")) {
    let score = 1;
    if (hasScoringTerm(titleText, context.slice("company_".length))) score += 0.5;
    if (matchingTerms(bodyText, ["technology", "platform", "software", "services", "innovation"]).length) {
      score += 0.3;
    }
    return Math.min(2.4, score);
  }

  if (!terms.length) return 0;
  const titleMatches = matchingTerms(titleText, terms);
  const bodyMatches = matchingTerms(bodyText, terms);
  let score = 0;
  if (titleMatches.length) score += 1;
  if (bodyMatches.length) score += 0.5;
  if (new Set([...titleMatches, ...bodyMatches]).size >= 2) score += 0.3;
  return Math.min(2.4, score);
}

function impactSignal(titleText, bodyText) {
  const strongTitle = matchingTerms(titleText, IMPACT_STRONG_TERMS);
  const strongBody = matchingTerms(bodyText, IMPACT_STRONG_TERMS);
  const mediumTitle = matchingTerms(titleText, IMPACT_MEDIUM_TERMS);
  const mediumBody = matchingTerms(bodyText, IMPACT_MEDIUM_TERMS);
  let score = 0;
  if (strongTitle.length) score += 1.2;
  else if (strongBody.length) score += 0.7;
  if (mediumTitle.length) score += 0.7;
  else if (mediumBody.length) score += 0.35;
  const scalePattern = /\b(?:\d[\d,.]*\s*(?:million|billion|thousand|m|bn|devices?|users?|customers?|households?|percent|%))\b/i;
  if (scalePattern.test(titleText) || scalePattern.test(bodyText)) score += 0.4;
  return Math.min(2.4, score);
}

function practicalValueSignal(titleText, bodyText) {
  const titleMatches = matchingTerms(titleText, PRACTICAL_TERMS);
  const bodyMatches = matchingTerms(bodyText, PRACTICAL_TERMS);
  const concreteChange = [
    "price",
    "pricing",
    "coverage",
    "speed",
    "access",
    "availability",
    "reliability",
    "capacity",
    "security",
    "privacy",
  ].some((term) => hasScoringTerm(titleText + " " + bodyText, term));
  let score = 0;
  if (titleMatches.length) score += 0.6;
  if (bodyMatches.length) score += 0.35;
  if (concreteChange) score += 0.4;
  return Math.min(1.3, score);
}

function noveltySignal(titleText, bodyText) {
  const titleMatches = matchingTerms(titleText, NOVELTY_TERMS);
  const bodyMatches = matchingTerms(bodyText, NOVELTY_TERMS);
  const milestone = ["first", "first commercial", "milestone", "surpasses", "reaches", "becomes"]
    .some((term) => hasScoringTerm(titleText, term));
  let score = 0;
  if (titleMatches.length) score += 0.6;
  if (milestone) score += 0.5;
  if (!titleMatches.length && bodyMatches.length) score += 0.25;
  return Math.min(1.1, score);
}

function penaltySignal(item, titleText, bodyText, impact, novelty) {
  const urlText = normaliseScoringText(item.url);
  const lowSignal = matchingTerms(titleText + " " + urlText, LOW_SIGNAL_TERMS).length > 0;
  const routine = matchingTerms(titleText, ROUTINE_TERMS).length > 0;
  const promotional = matchingTerms(titleText, PROMOTIONAL_TERMS).length > 0;
  let score = 0;
  if (lowSignal) score += 2.5;
  if (routine) score += impact === 0 && novelty === 0 ? 1 : 0.6;
  if (promotional && impact === 0) score += 0.2;
  return Math.min(3, score);
}

function sourceAuthority(host = "") {
  const h = host.replace(/^www\./, "").toLowerCase();
  return SOURCE_AUTHORITY[h] || (h.endsWith(".co.uk") ? 0.18 : 0);
}

function ageDays(iso, nowOverride) {
  if (!iso) return LOOKBACK_DAYS;
  const now = nowOverride
    ? (typeof nowOverride === "string" ? DateTime.fromISO(nowOverride, { zone: TIMEZONE }) : nowOverride)
    : DateTime.now().setZone(TIMEZONE);
  const d = DateTime.fromISO(iso, { zone: TIMEZONE });
  if (!d.isValid || !now?.isValid) return LOOKBACK_DAYS;
  return Math.max(0, now.diff(d, "days").days);
}

export function scoreItem(it, groupSize = 1, context = "general", options = {}) {
  const titleText = normaliseScoringText(it.title);
  const bodyText = scoringText(it);
  const age = ageDays(it.publishedAt, options.now);
  const impact = impactSignal(titleText, bodyText);
  const novelty = noveltySignal(titleText, bodyText);
  const distinctSourceCount = Math.max(1, Number(options.sourceCount) || 1);
  const breakdown = {
    topicFit: topicFitSignal(it, context, titleText, bodyText),
    impact,
    practicalValue: practicalValueSignal(titleText, bodyText),
    novelty,
    recency: Math.max(0, 0.9 - 0.09 * age),
    authority: Math.min(0.2, sourceAuthority(it.source) * 0.5),
    ukRelevance: Math.min(0.7, (ukSignals(it, context) / 2.2) * 0.7),
    crossSource: Math.min(0.5, Math.max(0, distinctSourceCount - 1) * 0.25),
    penalties: penaltySignal(it, titleText, bodyText, impact, novelty),
  };
  const score = 1 + Object.entries(breakdown)
    .filter(([key]) => key !== "penalties")
    .reduce((total, [, value]) => total + value, 0) - breakdown.penalties;
  return {
    score: Math.max(0, +score.toFixed(3)),
    breakdown: {
      ...breakdown,
      scoringVersion: INSIGHTS_SCORING_VERSION,
      groupSize: Math.max(1, Number(groupSize) || 1),
      distinctSourceCount,
    },
  };
}

/** =========================
 *  FEED + ENRICH
 *  ========================= */
const sitemapParser = new XMLParser({ ignoreAttributes: false });

async function fetchTextWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= FEED_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "NivsNewsRoomBot/1.2 (+youremail@example.com)" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Status code " + response.status);
      const text = await response.text();
      if (!text.trim()) throw new Error("Empty response body");
      return text;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      const permanent = /^Status code 4\d\d$/.test(message);
      if (attempt < FEED_RETRIES && !permanent) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

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

function canonicaliseUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return String(rawUrl || "").trim();
  }
}

function isAllowedHost(url, allowedHosts = []) {
  const host = normaliseHostname(hostnameOf(url));
  return !allowedHosts.length || allowedHosts.some((allowed) => normaliseHostname(allowed) === host);
}

function hasAnyTerm(item, terms = []) {
  const haystack = textify(item.title, item.snippet, item.excerpt);
  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function applySourceTopicFilters(items, source) {
  const includeTerms = source.includeTerms || [];
  const excludeTerms = source.excludeTerms || [];
  if (!includeTerms.length && !excludeTerms.length) return items;
  return items.filter((item) => {
    if (hasAnyTerm(item, excludeTerms)) return false;
    return !includeTerms.length || hasAnyTerm(item, includeTerms);
  });
}

async function resolveNewsLink(url) {
  if (hostnameOf(url) !== "news.google.com") return url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NivsNewsRoomBot/1.2 (+youremail@example.com)" },
      redirect: "follow",
      signal: controller.signal,
    });
    return response.url || url;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function parseFeed(url) {
  const feed = await parser.parseString(await fetchTextWithRetry(url));
  const hostFromFeed = normaliseHostname(hostnameOf(url));
  const rawItems = hostFromFeed === "news.google.com"
    ? (feed.items || []).slice(0, TEST_MODE ? 2 : SITEMAP_ITEM_LIMIT)
    : (feed.items || []);
  const items = await Promise.all(rawItems.map(async (i) => {
    const rawLink = String(i.link || "").trim();
    const link = await resolveNewsLink(rawLink);
    const sourceMetaUrl =
      typeof i.source === "object" ? String(i.source?.url || i.source?.href || "") : "";
    const hostFromLink = normaliseHostname(hostnameOf(link));
    const hostFromSource = normaliseHostname(hostnameOf(sourceMetaUrl));
    const iso = toISOorNull(i.isoDate || i.pubDate || null);
    return {
      title: sanitize(i.title || ""),
      url: canonicaliseUrl(link),
      publishedAt: iso,
      source: hostFromLink || hostFromSource || hostFromFeed,
      snippet: sanitize(i.contentSnippet || i.content || i.summary || ""),
    };
  }));

  let filtered = items.filter((it) => withinWindow(it.publishedAt));
  filtered.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  if (TEST_MODE) filtered = filtered.slice(0, 2);
  return filtered;
}

function filterSourceItems(items, source) {
  const valid = items.filter((item) => {
    if (!item.url || !isAllowedHost(item.url, source.allowedHosts)) return false;
    return Boolean(item.title && /^https?:\/\//i.test(item.url));
  });
  const topical = applySourceTopicFilters(valid, source);
  const maxItems = Number(source.maxItems);
  return Number.isFinite(maxItems) && maxItems > 0 ? topical.slice(0, maxItems) : topical;
}

function parseSitemapRows(xml) {
  const parsed = sitemapParser.parse(xml);
  const rows = Array.isArray(parsed?.urlset?.url)
    ? parsed.urlset.url
    : parsed?.urlset?.url
      ? [parsed.urlset.url]
      : [];
  return rows
    .map((row) => ({
      url: String(row?.loc || "").trim(),
      lastmod: String(row?.lastmod || "").trim(),
    }))
    .filter((row) => row.url);
}

async function getSitemapItems(source) {
  const xml = await fetchTextWithRetry(source.url);
  const rows = parseSitemapRows(xml);
  const candidates = rows
    .filter((row) => {
      const pathname = new URL(row.url).pathname;
      source.includePath.lastIndex = 0;
      return source.includePath.test(pathname);
    })
    .filter((row) => isAllowedHost(row.url, source.allowedHosts))
    .filter((row) => withinWindow(toISOorNull(row.lastmod)))
    .slice(0, TEST_MODE ? 2 : SITEMAP_ITEM_LIMIT);

  return candidates.map((row) => ({
    title: "",
    url: row.url,
    publishedAt: toISOorNull(row.lastmod),
    source: normaliseHostname(hostnameOf(row.url)),
    snippet: "",
  }));
}

async function getSourceItems(source) {
  try {
    const primaryItems = source.kind === "sitemap"
      ? await getSitemapItems(source)
      : await parseFeed(source.url);
    const items = source.kind === "sitemap"
      ? primaryItems
      : filterSourceItems(primaryItems, source);
    if (!items.length) throw new Error("No usable items");
    feedDiagnostics.push({
      source: source.label,
      feedUrl: source.url,
      kind: source.kind,
      mode: "primary",
      count: items.length,
    });
    return items;
  } catch (err) {
    const fallback = source.fallback || SOURCE_FALLBACKS[source.url];
    if (fallback) {
      try {
        console.warn("Source failed (" + source.url + "). Using fallback: " + fallback);
        const fallbackItems = filterSourceItems(await parseFeed(fallback), source);
        if (!fallbackItems.length) throw new Error("No usable fallback items");
        feedDiagnostics.push({
          source: source.label,
          feedUrl: source.url,
          kind: source.kind,
          mode: "fallback",
          fallback,
          count: fallbackItems.length,
        });
        return fallbackItems;
      } catch (fallbackError) {
        console.warn("Fallback failed (" + fallback + "): " + (fallbackError?.message || fallbackError));
        feedDiagnostics.push({
          source: source.label,
          feedUrl: source.url,
          kind: source.kind,
          mode: "failed",
          fallback,
          count: 0,
          error: String(fallbackError?.message || fallbackError),
        });
      }
    } else {
      console.warn("Source failed (" + source.url + "): " + (err?.message || err));
      feedDiagnostics.push({
        source: source.label,
        feedUrl: source.url,
        kind: source.kind,
        mode: "failed",
        count: 0,
        error: String(err?.message || err),
      });
    }
    return [];
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(label + " timed out after " + timeoutMs + "ms")),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function mapWithConcurrency(items, worker, limit) {
  const output = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(limit, Math.max(1, items.length)) },
    () => runWorker()
  ));
  return output.filter(Boolean);
}

/** Pull full article text; also keep a short excerpt */
async function addFullText(item) {
  try {
    const res = await withTimeout(extract(item.url), ARTICLE_TIMEOUT_MS, "Article extraction");
    const title = sanitize(item.title || res?.title || "");
    const publishedAt = toISOorNull(res?.published || res?.date || "") || item.publishedAt;
    const snippet = sanitize(item.snippet || res?.description || "");
    if (!title) {
      extractionFailures += 1;
      return null;
    }
    if (!res || !(res.content || res.text)) {
      extractionFailures += 1;
      return { ...item, title, publishedAt, snippet, fullText: "", excerpt: "" };
    }
    const plain = htmlToPlain(res.content || res.text || "");
    return {
      ...item,
      title,
      publishedAt,
      snippet,
      fullText: plain,
      excerpt: firstTwoParagraphs(plain),
    };
  } catch {
    extractionFailures += 1;
    return item.title ? { ...item, fullText: "", excerpt: "" } : null;
  }
}

export function filterFintechItems(items) {
  return items.filter((item) => {
    if (isBlockedFintechUrl(item.url)) return false;
    if (hasAnyTerm(item, FINTECH_EXCLUDE_TERMS)) return false;
    const host = normaliseHostname(item.source || hostnameOf(item.url));
    if (FINTECH_CATEGORY_HOSTS.has(host) || host === "fca.org.uk") return true;
    return hasAnyTerm(item, FINTECH_INCLUDE_TERMS);
  });
}

export function selectFintechContext(items) {
  const selected = [];
  const sourceCounts = new Map();
  for (const item of items) {
    const source = normaliseHostname(item.source || hostnameOf(item.url)) || item.url || item.title;
    const count = sourceCounts.get(source) || 0;
    if (count >= 3) continue;
    sourceCounts.set(source, count + 1);
    selected.push(item);
    if (selected.length >= FINTECH_CONTEXT_LIMIT) return selected;
  }

  return selected;
}

export function selectSummaryContext(items, limit = SUMMARY_LIMIT, options = {}) {
  const maxPerSource = Number.isFinite(options.maxPerSource) ? options.maxPerSource : 2;
  const diverse = options.diverse !== false;
  if (!diverse) return items.slice(0, limit);
  const sourceTotal = new Set(
    items.map((item) => normaliseHostname(item.source || hostnameOf(item.url))).filter(Boolean)
  ).size;
  const enforceSourceLimit = diverse && sourceTotal >= 3;
  const selected = [];
  const sourceCounts = new Map();
  const titleCounts = new Set();

  const add = (item, allowDuplicateTitle = false, allowSourceOverflow = false) => {
    const source = normaliseHostname(item.source || hostnameOf(item.url)) || item.url || item.title;
    const title = normalizeTitle(item.title);
    const sourceCount = sourceCounts.get(source) || 0;
    if (!allowSourceOverflow && enforceSourceLimit && sourceCount >= maxPerSource) return false;
    if (!allowDuplicateTitle && title && titleCounts.has(title)) return false;
    sourceCounts.set(source, sourceCount + 1);
    if (title) titleCounts.add(title);
    selected.push(item);
    return true;
  };

  for (const item of items) {
    if (selected.length >= limit) break;
    add(item);
  }
  if (selected.length < limit) {
    for (const item of items) {
      if (selected.length >= limit || selected.includes(item)) continue;
      add(item, true);
    }
  }
  if (selected.length < limit) {
    for (const item of items) {
      if (selected.length >= limit || selected.includes(item)) continue;
      add(item, true, true);
    }
  }
  return selected.slice(0, limit);
}

export function buildSummaryInputHash(items, versions = {}) {
  const payload = items.map((item) => ({
    url: item.url || "",
    title: item.title || "",
    publishedAt: item.publishedAt || null,
    excerpt: firstHalfWords(item.fullText || item.excerpt || item.snippet || "", FINTECH_WORDS_PER_ITEM_CAP),
  }));
  return createHash("sha256")
    .update(JSON.stringify({
      scoringVersion: versions.scoringVersion || INSIGHTS_SCORING_VERSION,
      version: versions.promptVersion || FINTECH_SUMMARY_PROMPT_VERSION,
      items: payload,
    }))
    .digest("hex");
}

async function writeJson(relPath, data) {
  if (DRY_RUN) {
    console.log(`[dry-run] would write ${relPath} (${Array.isArray(data) ? data.length : "object"})`);
    return;
  }
  const full = path.join(DATA_DIR, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(data, null, 2));
  console.log(`wrote ${relPath} (${Array.isArray(data) ? data.length : "object"})`);
}

async function readDataFile(relPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, relPath), "utf8"));
  } catch {
    return null;
  }
}

export function shouldPreservePrevious(previous, current) {
  return Array.isArray(current) &&
    current.length === 0 &&
    Array.isArray(previous) &&
    previous.length > 0;
}

async function writeSummary(relPath, summary) {
  if (DRY_RUN) {
    console.log(`[dry-run] would write ${relPath} (${(summary?.bullets || []).length} bullets)`);
    return;
  }
  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SUMMARY_DIR, relPath),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)
  );
}

async function readSummaryFile(relPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(SUMMARY_DIR, relPath), "utf8"));
  } catch {
    return null;
  }
}

/** =========================
 *  WEEKLY SUMMARY (AI once per tab) — PUNCHY STYLE
 *  ========================= */
// helpers for punchy bullets
function sluggyWords(s = "", max = 5) {
  const cleaned = String(s).replace(/[^\w\s\-&]/g, " ").replace(/\s+/g, " ").trim();
  const stop = new Set([
    "the","a","an","and","of","for","to","in","on","from","with","by","at","as","is","are","was","were","this","that"
  ]);
  const words = cleaned.split(" ").filter((w) => !stop.has(w.toLowerCase()));
  return words.slice(0, max).join(" ");
}

function makePunchyFallback(it) {
  const lead = sluggyWords(it.title, 5);
  // **Lead** — short insight (fallback uses title if no model)
  return `**${lead}** - ${it.source ? `(${it.source}) ` : ""}${it.title}`;
}

function firstHalfWords(plain = "", capPerItem = 600) {
  if (!plain) return "";
  const words = plain.trim().split(/\s+/);
  const half = Math.ceil(words.length * 0.5);
  return words.slice(0, Math.min(capPerItem, half)).join(" ");
}

function contextOfTab(tabName) {
  if (tabName === "hightech" || tabName === "telecoms") return tabName;
  if (tabName.startsWith("company_")) return tabName;
  return "general";
}

export async function generateWeeklyBullets(tabName, items) {
  const isFintech = tabName === "fintech";
  const promptVersion = isFintech
    ? FINTECH_SUMMARY_PROMPT_VERSION
    : GENERAL_SUMMARY_PROMPT_VERSION;
  if (!items || items.length === 0) {
    return {
      bullets: [],
      ...(isFintech ? { inputHash: buildSummaryInputHash([]) } : {}),
      promptVersion,
      scoringVersion: INSIGHTS_SCORING_VERSION,
      contextUrls: [],
      note: "no source items",
    };
  }

  const ctx = contextOfTab(tabName);

  // Build context from only the bounded ranked selection for this category.
  const summaryItems = isFintech
    ? selectFintechContext(items)
    : ctx.startsWith("company_")
      ? items.slice(0, SUMMARY_LIMIT)
      : selectSummaryContext(items, SUMMARY_LIMIT);
  const outputLimit = isFintech ? FINTECH_SUMMARY_OUTPUT_LIMIT : SUMMARY_LIMIT;
  const wordsPerItemCap = isFintech ? FINTECH_WORDS_PER_ITEM_CAP : 600;
  const contextUrls = summaryItems.map((item) => item.url).filter(Boolean);
  summaryContextCounts[tabName] = summaryItems.length;
  const inputHash = isFintech ? buildSummaryInputHash(summaryItems) : undefined;

  if (isFintech && inputHash) {
    const cached = await readSummaryFile("fintech.json");
    if (
      cached?.inputHash === inputHash &&
      cached?.promptVersion === FINTECH_SUMMARY_PROMPT_VERSION &&
      cached?.scoringVersion === INSIGHTS_SCORING_VERSION &&
      Array.isArray(cached?.bullets)
    ) {
      fintechSummaryCacheHits += 1;
      return {
        bullets: cached.bullets.slice(0, outputLimit),
        inputHash,
        promptVersion: FINTECH_SUMMARY_PROMPT_VERSION,
        scoringVersion: INSIGHTS_SCORING_VERSION,
        contextUrls,
        note: "cached (FinTech input unchanged)",
      };
    }
  }

  const ctxParts = [];
  for (const [i, it] of summaryItems.entries()) {
    const half = firstHalfWords(it.fullText || it.excerpt || it.snippet || "", wordsPerItemCap);

    const ukTag = ukSignals(it, ctx) > 0 ? "[UK-relevant]" : "";
    ctxParts.push(
      `${i + 1}. ${ukTag} TITLE: ${it.title}\nSOURCE: ${it.source}\nURL: ${it.url}\nTEXT:\n${half}\n---`
    );
  }
  const context = ctxParts.join("\n");

  // Fallback (no key)
  if (!process.env.OPENAI_API_KEY) {
    const bullets = summaryItems.slice(0, outputLimit).map((it) => ({
      text: makePunchyFallback(it),
      url: it.url,
    }));
    return {
      bullets,
      ...(isFintech ? { inputHash } : {}),
      promptVersion,
      scoringVersion: INSIGHTS_SCORING_VERSION,
      contextUrls,
      note: "fallback (no OPENAI_API_KEY)",
    };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    aiSummaryCalls += 1;
    if (isFintech) fintechAiSummaryCalls += 1;

    const system = isFintech
      ? [
        "You are Niv, a concise UK-focused FinTech curator.",
        "Write for an intelligent beginner who may not know specialist terms.",
        "Use a crisp, useful editorial tone. No first-person. No 'I saw', 'I read', or 'I learned'.",
        "Use ONLY the supplied top FinTech articles. Do not invent facts, numbers, dates, causes, or consequences.",
        "Choose the most meaningful supplied stories and return no more than five bullets.",
        "Synthesize related articles into distinct themes where useful, but do not combine unrelated facts.",
        "Every bullet must explain what happened and why it matters in plain English.",
        "Mention who may be affected when the supplied context supports it.",
        "Expand important acronyms or technical terms at first use, briefly.",
        "Avoid jargon, generic AI language, empty hype, and company marketing claims.",
        "Each bullet starts with a clear PUNCH LEAD of 2–5 words in Title Case.",
        "Follow the lead with an em dash and one concise sentence of no more than 28 words.",
        "You may use **double asterisks** for a small number of key terms.",
        "Return STRICT JSON only: {\"bullets\":[{\"text\":\"...\",\"urls\":[\"...\"]}, ...]}.",
        "If you include URLs, they must come from the supplied articles.",
        "Prefer [UK-relevant] items when the stories are otherwise similarly important."
      ].join(" ")
      : [
        "You are Niv, a concise UK tech, telecoms, and innovation curator.",
        "Write for an intelligent beginner who may not know specialist terms.",
        "Use a crisp, useful editorial tone. No first-person. No 'I saw', 'I read', or 'I learned'.",
        "Use ONLY the supplied articles. Do not invent facts, numbers, dates, causes, or consequences.",
        "Choose the most meaningful supplied stories and return no more than five bullets.",
        "Every bullet must explain what happened and why it matters in plain English.",
        "Mention who may be affected when the supplied context supports it.",
        "Expand important acronyms or technical terms at first use, briefly.",
        "Avoid jargon, generic AI language, empty hype, and company marketing claims.",
        "Each bullet starts with a clear PUNCH LEAD of 2–5 words in Title Case.",
        "Follow the lead with an em dash and one concise sentence of no more than 28 words.",
        "You may use **double asterisks** for a small number of key terms.",
        "Return STRICT JSON only: {\"bullets\":[{\"text\":\"...\",\"urls\":[\"...\"]}, ...]}.",
        "If you include URLs, they must come from the supplied articles.",
        "Prefer [UK-relevant] items when the stories are otherwise similarly important."
      ].join(" ");

    const user = `Create my weekly summary for "${tabName}" based ONLY on this dataset:\n\n${context}`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.25,
      max_completion_tokens: 400,
      response_format: { type: "json_object" },
    });

    const raw = resp.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    // Default to punchy fallback list
    let bullets = summaryItems.map((it) => ({
      text: makePunchyFallback(it),
      url: it.url,
    }));

    if (parsed && Array.isArray(parsed.bullets) && parsed.bullets.length) {
      // Only keep URLs we actually ingested
      const allowed = new Set(summaryItems.map((it) => it.url).filter(Boolean));
      const fromModel = parsed.bullets.slice(0, outputLimit).map((b) => {
        const firstUrl =
          Array.isArray(b.urls) && b.urls[0] && allowed.has(String(b.urls[0]))
            ? String(b.urls[0])
            : undefined;
        return {
          text: String(b.text || "").trim(),
          url: firstUrl,
        };
      });

      // Safety: remove accidental first-person starts and tidy whitespace
      const cleaned = fromModel.map((b) => ({
        ...b,
        text: b.text
          .replace(/^\s*i\s+|^\s*i['’]m\s+/i, "")
          .replace(/\s+/g, " ")
          .trim(),
      }));

      const seenUrls = new Set();
      const validModelBullets = cleaned.filter((bullet) => {
        if (!bullet.text) return false;
        if (bullet.url && seenUrls.has(bullet.url)) return false;
        if (bullet.url) seenUrls.add(bullet.url);
        return true;
      });
      const topUp = summaryItems
        .filter((item) => !seenUrls.has(item.url))
        .map((item) => ({ text: makePunchyFallback(item), url: item.url }));
      bullets = validModelBullets.concat(topUp).slice(0, outputLimit);
    }

    return {
      bullets: bullets.slice(0, outputLimit),
      ...(isFintech ? { inputHash } : {}),
      promptVersion,
      scoringVersion: INSIGHTS_SCORING_VERSION,
      contextUrls,
    };
  } catch (e) {
    const bullets = summaryItems.slice(0, outputLimit).map((it) => ({
      text: makePunchyFallback(it),
      url: it.url,
    }));
    return {
      bullets: bullets.slice(0, outputLimit),
      ...(isFintech ? { inputHash } : {}),
      promptVersion,
      scoringVersion: INSIGHTS_SCORING_VERSION,
      contextUrls,
      note: "fallback (summary generation error)",
    };
  }
}

/** =========================
 *  SCORING / ORDERING with UK weighting
 *  ========================= */
export function annotateHotness(items, context, options = {}) {
  const map = new Map();
  items.forEach((it, idx) => {
    const key = normalizeTitle(it.title) || it.url || String(idx);
    const arr = map.get(key) || [];
    arr.push(idx);
    map.set(key, arr);
  });

  const out = items.map((it) => ({ ...it, score: 1, groupSize: 1, tags: [] }));
  for (const [, idxs] of map.entries()) {
    const size = idxs.length;
    const distinctSourceCount = new Set(
      idxs.map((index) => normaliseHostname(out[index].source || hostnameOf(out[index].url))).filter(Boolean)
    ).size || 1;
    for (const i of idxs) {
      const item = out[i];
      const scored = scoreItem(item, size, context, {
        now: options.now,
        sourceCount: distinctSourceCount,
      });

      const tags = [...(item.tags || [])];
      if (detectTopTake(item.title)) tags.push("top-take");
      if (ukSignals(item, context) > 0) tags.push("uk");
      if (scored.breakdown.impact >= 0.7) tags.push("high-impact");
      if (scored.breakdown.penalties >= 2.5) tags.push("low-signal");
      if (scored.breakdown.penalties >= 0.6 && scored.breakdown.penalties < 2.5) tags.push("routine");

      out[i] = {
        ...item,
        score: scored.score,
        groupSize: size,
        scoringVersion: INSIGHTS_SCORING_VERSION,
        scoreBreakdown: scored.breakdown,
        tags: [...new Set(tags)],
      };
    }
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = new Date(a.publishedAt || 0).getTime();
    const tb = new Date(b.publishedAt || 0).getTime();
    if (tb !== ta) return tb - ta;
    return String(a.url || "").localeCompare(String(b.url || ""));
  });

  return out;
}

/** =========================
 *  PROCESSORS
 *  ========================= */
function isCompanyUrlAllowed(company, url) {
  const allowedHosts = COMPANY_ALLOWED_HOSTS[company];
  if (!allowedHosts) return false;
  const host = normaliseHostname(hostnameOf(url));
  return [...allowedHosts].some((allowed) => normaliseHostname(allowed) === host);
}

async function processGroupWeekly(key, sources) {
  const collected = [];
  for (const source of sources) {
    const items = await getSourceItems(source);
    collected.push(...items);
  }

  const unique = dedupeByUrl(collected);
  const enriched = await mapWithConcurrency(unique, addFullText, ARTICLE_CONCURRENCY);
  const prepared = key === "fintech" ? filterFintechItems(enriched) : enriched;

  const ranked = annotateHotness(prepared, key);
  if (!ranked.length) {
    const previous = await readDataFile(key + ".json");
    const previousSummary = await readSummaryFile(key + ".json");
    if (shouldPreservePrevious(previous, ranked)) {
      preservedEmptySources.push(key);
      console.warn(
        "No current " + key + " items; preserving " + previous.length +
        " previously generated items and summary."
      );
      return {
        key,
        items: previous.length,
        bullets: Array.isArray(previousSummary?.bullets) ? previousSummary.bullets.length : 0,
        preservedPrevious: true,
      };
    }
  }
  await writeJson(`${key}.json`, ranked);

  const summary = await generateWeeklyBullets(key, ranked);
  await writeSummary(`${key}.json`, summary);
  console.log(`wrote summaries/${key}.json (${(summary?.bullets || []).length} bullets)`);
  return { key, items: ranked.length, bullets: (summary?.bullets || []).length };
}

async function processCompanyWeekly(company) {
  if (!COMPANY_KEYS.includes(company)) {
    throw new Error("Unknown company source: " + company);
  }

  const collected = [];
  for (const source of COMPANY_SOURCES[company]) {
    const items = await getSourceItems(source);
    collected.push(...items);
  }

  const unique = dedupeByUrl(collected);
  const companyItems = unique.filter((item) => isCompanyUrlAllowed(company, item.url));
  const enriched = await mapWithConcurrency(companyItems, addFullText, ARTICLE_CONCURRENCY);

  const context = `company_${company}`;
  const ranked = annotateHotness(enriched, context);
  if (!ranked.length) {
    const previous = await readDataFile("company/" + company + ".json");
    const previousSummary = await readSummaryFile("company_" + company + ".json");
    if (shouldPreservePrevious(previous, ranked)) {
      preservedEmptySources.push(context);
      console.warn(
        "No current " + context + " items; preserving " + previous.length +
        " previously generated items and summary."
      );
      return {
        key: context,
        items: previous.length,
        bullets: Array.isArray(previousSummary?.bullets) ? previousSummary.bullets.length : 0,
        preservedPrevious: true,
      };
    }
  }
  await writeJson(`company/${company}.json`, ranked);

  const summary = await generateWeeklyBullets(context, ranked);
  await writeSummary(`company_${company}.json`, summary);
  console.log(`wrote summaries/company_${company}.json (${(summary?.bullets || []).length} bullets)`);
  return { key: context, items: ranked.length, bullets: (summary?.bullets || []).length };
}

/** =========================
 *  MAIN
 *  ========================= */
async function main() {
  // Groups
  const results = [];
  if (INGEST_GROUP) {
    if (INGEST_GROUP !== "fintech") {
      throw new Error("Unsupported INGEST_GROUP: " + INGEST_GROUP);
    }
    results.push(await processGroupWeekly("fintech", FEED_SOURCES.fintech));
  } else {
    results.push(await processGroupWeekly("hightech", FEED_SOURCES.hightech));
    results.push(await processGroupWeekly("telecoms", FEED_SOURCES.telecoms));
    results.push(await processGroupWeekly("fintech", FEED_SOURCES.fintech));

    // Company sources: Accenture, Capco, and Sage.
    for (const company of COMPANY_KEYS) {
      results.push(await processCompanyWeekly(company));
    }
  }

  const totalItems = results.reduce((sum, result) => sum + result.items, 0);
  console.log("Ingest diagnostics:", JSON.stringify({
    dryRun: DRY_RUN,
    testMode: TEST_MODE,
    ingestGroup: INGEST_GROUP || "all",
    lookbackDays: LOOKBACK_DAYS,
    groups: results,
    aiSummaryCalls,
    fintechAiSummaryCalls,
    fintechSummaryCacheHits,
    scoringVersion: INSIGHTS_SCORING_VERSION,
    summaryContextCounts,
    preservedEmptySources,
    extractionFailures,
    feeds: feedDiagnostics,
  }, null, 2));

  if (totalItems === 0) {
    throw new Error("Ingest produced zero items across all content groups");
  }

  return results;
}

export async function runAll() {
  await main();
}

// Only run when directly invoked via CLI: `node scripts/ingest.mjs`
const isDirect =
  process.argv?.[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  runAll().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
