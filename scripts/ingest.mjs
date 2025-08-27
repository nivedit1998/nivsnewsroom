/* scripts/ingest.mjs */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import RSSParser from "rss-parser";
import { DateTime } from "luxon";
import { extract } from "@extractus/article-extractor";
import { fileURLToPath } from "node:url";

/** =========================
 *  SETTINGS
 *  ========================= */
const TIMEZONE = "Europe/London";
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "7", 10);
const TEST_MODE = process.env.TEST_MODE === "1";

const DATA_DIR = path.join(process.cwd(), "public", "data");
const SUMMARY_DIR = path.join(DATA_DIR, "summaries");

const parser = new RSSParser({
  requestOptions: {
    headers: { "User-Agent": "NivsNewsRoomBot/1.4 (+youremail@example.com)" },
  },
});

/** =========================
 *  SOURCES
 *  =========================
 *  - telecoms: industry/b2b networks, carriers, fibre, spectrum, policy
 *  - hightech: software, consumer tech, phones, platforms
 */
const SOURCES = {
  hightech: [
    "https://arstechnica.com/feed/",
    "https://www.engadget.com/rss.xml",
    "https://www.tomshardware.com/feeds/all",
    "https://www.androidauthority.com/feed/",
    "https://9to5google.com/feed/",
    "https://9to5mac.com/feed/",
    "https://www.macrumors.com/macrumors.xml",
    "https://www.theregister.com/headlines.atom",   // UK-leaning
    "https://uktechnews.co.uk/feed/",              // UK-leaning
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
    // (keep cnet if you like broader consumer: "https://www.cnet.com/rss/news/")
  ],
  telecoms: [
    "https://www.rcrwireless.com/rss",
    "https://www.lightreading.com/rss_simple.asp",
    "https://telecomstechnews.com/feed",
    "https://www.fierce-network.com/rss/xml",      // Fierce Network / FierceTelecom
    "https://telecoms.com/feed/",
    "https://www.totaltele.com/feed/",
    "https://www.capacitymedia.com/rss",
    "https://www.mobileworldlive.com/latest-stories/feed",
    "https://telecomtv.com/site/rss/",
    // UK broadband + regulator
    "https://www.ispreview.co.uk/feed",
    "https://www.thinkbroadband.com/news/rss.xml",
    "https://www.ofcom.org.uk/about-ofcom/latest/rss",
  ],
};

/** =========================
 *  COMPANY FEEDS (first-party owned)
 *  ========================= */
const COMPANY_RSS = {
  microsoft: [
    "https://blogs.microsoft.com/feed/",
    "https://azure.microsoft.com/en-us/blog/feed/",
    "https://www.microsoft.com/en-us/microsoft-365/blog/feed/",
    "https://blogs.windows.com/feed/",
    "https://devblogs.microsoft.com/feed/",
    "https://www.microsoft.com/en-us/security/blog/feed/",
  ],
  sage: [
    "https://www.sage.com/en-gb/blog/feed/",
    "https://www.sage.com/en-gb/newsroom/feed/",
  ],
};

/** =========================
 *  UK PRIORITY SIGNALS
 *  ========================= */
const UK_DOMAINS = new Set([
  "bbc.co.uk",
  "gov.uk",
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
  "theguardian.com",
]);

const UK_KEYWORDS = [
  " uk ", " u.k. ", " united kingdom", " britain", " british",
  " england", " scotland", " wales", " northern ireland",
  " london", " manchester", " birmingham", " edinburgh",
  " cardiff", " belfast", " ofcom", " regulator ofcom", " nhs",
];

const UK_TELECOM_TERMS = [
  "bt","openreach","vodafone uk","vodafone uk’s","virgin media o2","vmo2",
  "o2 uk","ee","three uk","sky","talktalk","cityfibre","ofcom",
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
      haystack.includes(" microsoft uk") ||
      haystack.includes(" sage uk") ||
      haystack.includes(" uk ") ||
      haystack.includes(" united kingdom") ||
      haystack.includes(" london");
  }

  const wDomain = domainHit ? 0.9 : 0;
  const wKeyword = keywordHit ? 0.7 : 0;
  const wCompany = companyHit ? 0.8 : 0;

  let score =
    (wDomain + wKeyword + wCompany) *
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

/** Normalise URLs to avoid UTM/ID noise creating duplicates */
function cleanUrl(u = "") {
  try {
    const url = new URL(u);
    const keep = new Set(["id", "p"]);
    [...url.searchParams.keys()].forEach((k) => {
      const kk = k.toLowerCase();
      const isUtm =
        kk.startsWith("utm_") || ["fbclid","gclid","yclid","mc_cid","mc_eid"].includes(kk);
      if (isUtm || (!keep.has(kk) && kk.length > 1)) url.searchParams.delete(k);
    });
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((it) => {
    const u = it.url ? cleanUrl(it.url) : "";
    const host = it.source ? it.source.toLowerCase() : "";
    const key = (host + "|" + (u || it.title || "")).toLowerCase();
    if (!key) return false;
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
  const table = {
    // hightech
    "arstechnica.com": 0.25,
    "engadget.com": 0.2,
    "tomshardware.com": 0.2,
    "androidauthority.com": 0.2,
    "9to5google.com": 0.15,
    "9to5mac.com": 0.15,
    "macrumors.com": 0.15,
    "theregister.com": 0.22,
    "uktechnews.co.uk": 0.18,
    "techcrunch.com": 0.25,
    "theverge.com": 0.25,

    // telecoms
    "rcrwireless.com": 0.25,
    "lightreading.com": 0.28,
    "fierce-network.com": 0.24,
    "telecoms.com": 0.24,
    "totaltele.com": 0.2,
    "capacitymedia.com": 0.18,
    "mobileworldlive.com": 0.2,
    "telecomtv.com": 0.18,
    "ispreview.co.uk": 0.25,
    "thinkbroadband.com": 0.25,
    "ofcom.org.uk": 0.35,

    // company first-party
    "blogs.microsoft.com": 0.3,
    "azure.microsoft.com": 0.3,
    "microsoft.com": 0.25,
    "blogs.windows.com": 0.3,
    "devblogs.microsoft.com": 0.3,
    "sage.com": 0.25,
  };
  return table[h] || (h.endsWith(".co.uk") ? 0.18 : 0);
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
async function parseFeed(url) {
  const feed = await parser.parseURL(url);
  let items = (feed.items || []).map((i) => {
    const link = i.link || "";
    const hostFromLink = link ? new URL(link).hostname.replace(/^www\./, "") : "";
    const hostFromFeed = new URL(url).hostname.replace(/^www\./, "");
    const iso = toISOorNull(i.isoDate || i.pubDate || null);
    return {
      title: sanitize(i.title || ""),
      url: link,
      publishedAt: iso,
      source: hostFromLink || hostFromFeed,
      snippet: sanitize(i.contentSnippet || i.content || i.summary || ""),
    };
  });

  const before = items.length;
  items = items.filter((it) => withinWindow(it.publishedAt));
  const after = items.length;
  console.log(`[feed] ${url} -> ${before} items, ${after} within ${LOOKBACK_DAYS}d`);

  items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  if (TEST_MODE) items = items.slice(0, 2);
  return items;
}

async function getFeedItems(feedUrl) {
  try {
    return await parseFeed(feedUrl);
  } catch (err) {
    console.warn(`Feed failed (${feedUrl}): ${err?.message || err}`);
    // No fallback: only real feeds as requested
    return [];
  }
}

/** Pull full article text; also keep a short excerpt */
async function addFullText(item) {
  try {
    const res = await extract(item.url);
    if (!res || !(res.content || res.text)) return { ...item, fullText: "", excerpt: "" };
    const plain = htmlToPlain(res.content || res.text || "");
    return { ...item, fullText: plain, excerpt: firstTwoParagraphs(plain) };
  } catch {
    return { ...item, fullText: "", excerpt: "" };
  }
}

async function writeJson(relPath, data) {
  const full = path.join(DATA_DIR, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(data, null, 2));
  console.log(`wrote ${relPath} (${Array.isArray(data) ? data.length : "object"})`);
}

/** =========================
 *  WEEKLY SUMMARY (AI once per tab) — ALWAYS 10 ITEMS
 *  ========================= */
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

function topUpToTen(bullets, rankedItems) {
  const used = new Set(bullets.map((b) => (b.url || "").toLowerCase()).filter(Boolean));
  for (const it of rankedItems) {
    if (bullets.length >= 10) break;
    const u = (it.url || "").toLowerCase();
    if (!u || used.has(u)) continue;
    bullets.push({ text: makePunchyFallback(it), url: it.url });
    used.add(u);
  }
  // If still under 10 (rare), add title-only fallbacks
  for (const it of rankedItems) {
    if (bullets.length >= 10) break;
    bullets.push({ text: makePunchyFallback(it) });
  }
  return bullets.slice(0, 10);
}

async function generateWeeklyBullets(tabName, rankedItems) {
  const items = rankedItems; // already hotness-sorted
  if (!items || items.length === 0) return { bullets: [], note: "no source items" };

  const ctx = contextOfTab(tabName);

  // Build rich context: up to N items, each with ~50% body (capped)
  const CONTEXT_ITEM_LIMIT = 80;
  const WORDS_PER_ITEM_CAP = 600;
  const TOTAL_WORD_BUDGET = 12000;

  const ctxParts = [];
  let totalWords = 0;
  for (const [i, it] of items.slice(0, CONTEXT_ITEM_LIMIT).entries()) {
    const half = firstHalfWords(it.fullText || it.excerpt || it.snippet || "", WORDS_PER_ITEM_CAP);
    const w = half ? half.trim().split(/\s+/).length : 0;
    if (totalWords + w > TOTAL_WORD_BUDGET) break;
    totalWords += w;

    const ukTag = ukSignals(it, ctx) > 0 ? "[UK-relevant]" : "";
    ctxParts.push(
      `${i + 1}. ${ukTag} TITLE: ${it.title}\nSOURCE: ${it.source}\nURL: ${it.url}\nTEXT:\n${half}\n---`
    );
  }
  const context = ctxParts.join("\n");

  // No key? Fall back to punchy, filled to 10.
  if (!process.env.OPENAI_API_KEY) {
    return { bullets: topUpToTen([], items) };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = [
      "You are Niv, a concise UK tech & telecoms curator.",
      "Write in a crisp editorial tone. No first-person.",
      "For EACH item:",
      "- Start with a PUNCH LEAD: 2–5 words in Title Case.",
      "- Then an em dash (-) and ONE insight sentence (≤ 20 words).",
      "- You may bold KEY TERMS/COMPANIES using **double asterisks**.",
      "- Use ONLY the provided items; do not invent facts.",
      "Return STRICT JSON only: {\"bullets\":[{\"text\":\"...\",\"urls\":[\"...\"]}, ...]}",
      "If you include URLs, they must come from the provided items (1–3 per bullet).",
      "Prefer items marked [UK-relevant] when selecting or phrasing.",
      "Return **exactly 10 bullets** when possible; otherwise return as many as available.",
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

    let bullets = [];
    if (parsed && Array.isArray(parsed.bullets)) {
      const allowed = new Set(items.map((it) => it.url).filter(Boolean));
      const fromModel = parsed.bullets.slice(0, 10).map((b) => {
        const firstUrl =
          Array.isArray(b.urls) && b.urls[0] && allowed.has(String(b.urls[0]))
            ? String(b.urls[0])
            : undefined;
        return {
          text: String(b.text || "").replace(/^\s*i\s+|^\s*i['’]m\s+/i, "").replace(/\s+/g, " ").trim(),
          url: firstUrl,
        };
      }).filter((b) => b.text);
      bullets = fromModel;
    }

    // Top up to 10 (using ranked items) if model returned fewer
    bullets = topUpToTen(bullets, items);
    return { bullets };
  } catch (e) {
    return { bullets: topUpToTen([], items), note: "fallback (summary generation error)" };
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
async function processGroupWeekly(key, urls) {
  const collected = [];
  for (const u of urls) {
    const items = await getFeedItems(u);
    collected.push(...items);
  }
  console.log(`[group] ${key}: collected=${collected.length}`);

  const unique = dedupeByUrl(collected);
  console.log(`[group] ${key}: unique(after-dedupe)=${unique.length}`);

  const enriched = await Promise.all(unique.map(addFullText));

  const ranked = annotateHotness(enriched, key);
  await writeJson(`${key}.json`, ranked);

  const summary = await generateWeeklyBullets(key, ranked);
  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SUMMARY_DIR, `${key}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)
  );
  console.log(`wrote summaries/${key}.json (${(summary?.bullets || []).length} bullets)`);
}

async function processCompanyWeekly(company, rssUrls) {
  const collected = [];
  for (const u of rssUrls) {
    const items = await getFeedItems(u);
    collected.push(...items);
  }
  console.log(`[company] ${company}: collected=${collected.length}`);

  const unique = dedupeByUrl(collected);
  console.log(`[company] ${company}: unique(after-dedupe)=${unique.length}`);

  const enriched = await Promise.all(unique.map(addFullText));
  const context = `company_${company}`;
  const ranked = annotateHotness(enriched, context);
  await writeJson(`company/${company}.json`, ranked);

  const summary = await generateWeeklyBullets(context, ranked);
  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SUMMARY_DIR, `company_${company}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)
  );
  console.log(`wrote summaries/company_${company}.json (${(summary?.bullets || []).length} bullets)`);
}

/** =========================
 *  MAIN
 *  ========================= */
async function main() {
  // Groups
  await processGroupWeekly("hightech", SOURCES.hightech);
  await processGroupWeekly("telecoms", SOURCES.telecoms);

  // Companies (first-party)
  await processCompanyWeekly("microsoft", COMPANY_RSS.microsoft);
  await processCompanyWeekly("sage", COMPANY_RSS.sage);
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
