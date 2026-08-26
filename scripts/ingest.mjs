/* scripts/ingest.mjs */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

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
const FEED_TIMEOUT_MS = 20_000;
const FEED_RETRIES = 2;
const ARTICLE_TIMEOUT_MS = 20_000;
const ARTICLE_CONCURRENCY = 4;
const SITEMAP_ITEM_LIMIT = 30;

const DATA_DIR = path.join(process.cwd(), "public", "data");
const SUMMARY_DIR = path.join(DATA_DIR, "summaries");
const feedDiagnostics = [];
let extractionFailures = 0;

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
    (context === "telecoms" ? 1.15 : context.startsWith("company_") ? 1.1 : 1.0);

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

function sourceAuthority(host = "") {
  const h = host.replace(/^www\./, "").toLowerCase();
  return SOURCE_AUTHORITY[h] || (h.endsWith(".co.uk") ? 0.18 : 0);
}

function ageDays(iso) {
  if (!iso) return LOOKBACK_DAYS;
  const now = DateTime.now().setZone(TIMEZONE);
  const d = DateTime.fromISO(iso, { zone: TIMEZONE });
  if (!d.isValid) return LOOKBACK_DAYS;
  return Math.max(0, now.diff(d, "days").days);
}

/** Compute hotness score WITH UK boost */
function scoreItem(it, groupSize, context) {
  const pop = Math.log1p(groupSize || 1);
  const age = ageDays(it.publishedAt);
  const recency = Math.max(0, 1.5 - 0.12 * age);
  const analysis = detectTopTake(it.title) ? 0.5 : 0;
  const authority = sourceAuthority(it.source);
  const ukBoost = ukSignals(it, context);
  return +(1 + pop + recency + analysis + authority + ukBoost).toFixed(3);
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

function isAllowedHost(url, allowedHosts = []) {
  const host = normaliseHostname(hostnameOf(url));
  return !allowedHosts.length || allowedHosts.some((allowed) => normaliseHostname(allowed) === host);
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
      url: link,
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
  return items.filter((item) => {
    if (!item.url || !isAllowedHost(item.url, source.allowedHosts)) return false;
    return Boolean(item.title && /^https?:\/\//i.test(item.url));
  });
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

async function generateWeeklyBullets(tabName, items) {
  if (!items || items.length === 0) {
    return { bullets: [], note: "no source items" };
  }

  const ctx = contextOfTab(tabName);

  // Build context from only the top five ranked items.
  const summaryItems = items.slice(0, SUMMARY_LIMIT);
  const WORDS_PER_ITEM_CAP = 600;

  const ctxParts = [];
  for (const [i, it] of summaryItems.entries()) {
    const half = firstHalfWords(it.fullText || it.excerpt || it.snippet || "", WORDS_PER_ITEM_CAP);

    const ukTag = ukSignals(it, ctx) > 0 ? "[UK-relevant]" : "";
    ctxParts.push(
      `${i + 1}. ${ukTag} TITLE: ${it.title}\nSOURCE: ${it.source}\nURL: ${it.url}\nTEXT:\n${half}\n---`
    );
  }
  const context = ctxParts.join("\n");

  // Fallback (no key)
  if (!process.env.OPENAI_API_KEY) {
    const bullets = summaryItems.map((it) => ({
      text: makePunchyFallback(it),
      url: it.url,
    }));
    return { bullets, note: "fallback (no OPENAI_API_KEY)" };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = [
      "You are Niv, a concise UK tech & telecoms curator.",
      "Write in a crisp editorial tone. No first-person. No 'I saw / I read / I learned'.",
      "For EACH supplied item:",
      "- Start with a PUNCH LEAD: 2–5 words that capture the gist, in Title Case, enthusiastic but professional.",
      "- Then an em dash (-) and ONE short insight sentence (≤ 20 words).",
      "- You may bold KEY TERMS/COMPANIES using **double asterisks**.",
      "- Use ONLY the provided items; do not invent facts.",
      "Return STRICT JSON only: {\"bullets\":[{\"text\":\"...\",\"urls\":[\"...\"]}, ...]}",
      "Create at most five bullets, one for each supplied item.",
      "If you include URLs, they must come from the supplied items.",
      "Prefer items marked [UK-relevant] when selecting or phrasing."
    ].join(" ");

    const user = `Create my weekly summary for "${tabName}" based ONLY on this dataset:\n\n${context}`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.25,
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
      const fromModel = parsed.bullets.slice(0, SUMMARY_LIMIT).map((b) => {
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
      bullets = validModelBullets.concat(topUp).slice(0, SUMMARY_LIMIT);
    }

    return { bullets };
  } catch (e) {
    const bullets = summaryItems.map((it) => ({
      text: makePunchyFallback(it),
      url: it.url,
    }));
    return { bullets: bullets.slice(0, SUMMARY_LIMIT), note: "fallback (summary generation error)" };
  }
}

/** =========================
 *  SCORING / ORDERING with UK weighting
 *  ========================= */
function annotateHotness(items, context) {
  const map = new Map();
  items.forEach((it, idx) => {
    const key = normalizeTitle(it.title);
    if (!key) return;
    const arr = map.get(key) || [];
    arr.push(idx);
    map.set(key, arr);
  });

  const out = items.map((it) => ({ ...it, score: 1, groupSize: 1, tags: [] }));
  for (const [, idxs] of map.entries()) {
    const size = idxs.length;
    for (const i of idxs) {
      const item = out[i];
      const score = scoreItem(item, size, context);

      const tags = [...(item.tags || [])];
      if (detectTopTake(item.title)) tags.push("top-take");
      if (ukSignals(item, context) > 0) tags.push("uk");

      out[i] = { ...item, score, groupSize: size, tags };
    }
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = new Date(a.publishedAt || 0).getTime();
    const tb = new Date(b.publishedAt || 0).getTime();
    return tb - ta;
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

  const ranked = annotateHotness(enriched, key);
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
  results.push(await processGroupWeekly("hightech", FEED_SOURCES.hightech));
  results.push(await processGroupWeekly("telecoms", FEED_SOURCES.telecoms));

  // Company sources: Accenture, Capco, and Sage.
  for (const company of COMPANY_KEYS) {
    results.push(await processCompanyWeekly(company));
  }

  const totalItems = results.reduce((sum, result) => sum + result.items, 0);
  console.log("Ingest diagnostics:", JSON.stringify({
    dryRun: DRY_RUN,
    testMode: TEST_MODE,
    lookbackDays: LOOKBACK_DAYS,
    groups: results,
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
