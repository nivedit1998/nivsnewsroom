/* scripts/ingest.mjs */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import RSSParser from "rss-parser";
import { DateTime } from "luxon";
import { extract } from "@extractus/article-extractor";

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
    headers: { "User-Agent": "NivsNewsRoomBot/1.0 (+youremail@example.com)" },
  },
});

/** =========================
 *  SOURCES
 *  ========================= */
const SOURCES = {
  hightech: [
    "https://www.cnet.com/rss/news/",
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
  ],
  telecoms: [
    "https://telecomstechnews.com/feed",
    "https://totaltele.com/category/technology/feed/",
    "https://www.rcrwireless.com/rss",
  ],
};

const FEED_FALLBACKS = {
  "https://telecomstechnews.com/feed":
    "https://news.google.com/rss/search?q=site:telecomstechnews.com+UK",
  "https://totaltele.com/category/technology/feed/":
    "https://news.google.com/rss/search?q=site:totaltele.com+UK",
  "https://www.rcrwireless.com/rss":
    "https://news.google.com/rss/search?q=site:rcrwireless.com+UK",
};

const COMPANY_RSS = {
  microsoft: ["https://blogs.microsoft.com/feed/"],
  sage: ["https://www.sage.com/en-gb/blog/feed/"],
};

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

/** Convert HTML → plain while preserving paragraph breaks as \n\n */
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
  const table = {
    "theverge.com": 0.25,
    "techcrunch.com": 0.25,
    "cnet.com": 0.2,
    "rcrwireless.com": 0.25,
    "totaltele.com": 0.2,
    "telecomstechnews.com": 0.15,
    "blogs.microsoft.com": 0.1,
    "sage.com": 0.1,
  };
  return table[h] || 0;
}

function ageDays(iso) {
  if (!iso) return LOOKBACK_DAYS;
  const now = DateTime.now().setZone(TIMEZONE);
  const d = DateTime.fromISO(iso, { zone: TIMEZONE });
  if (!d.isValid) return LOOKBACK_DAYS;
  return Math.max(0, now.diff(d, "days").days);
}

/** Compute hotness score */
function scoreItem(it, groupSize) {
  const pop = Math.log1p(groupSize || 1);
  const age = ageDays(it.publishedAt);
  const recency = Math.max(0, 1.5 - 0.12 * age);
  const analysis = detectTopTake(it.title) ? 0.5 : 0;
  const authority = sourceAuthority(it.source);
  return +(1 + pop + recency + analysis + authority).toFixed(3);
}

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

  items = items.filter((it) => withinWindow(it.publishedAt));
  items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  if (TEST_MODE) items = items.slice(0, 2);
  return items;
}

async function getFeedItems(feedUrl) {
  try {
    return await parseFeed(feedUrl);
  } catch (err) {
    const fb = FEED_FALLBACKS[feedUrl];
    if (fb) {
      try {
        console.warn(`Feed failed (${feedUrl}). Using fallback: ${fb}`);
        return await parseFeed(fb);
      } catch (e2) {
        console.warn(`Fallback failed (${fb}): ${e2?.message || e2}`);
      }
    } else {
      console.warn(`Feed failed (${feedUrl}): ${err?.message || err}`);
    }
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
 *  WEEKLY SUMMARY (AI once per tab) — feed ~50% of articles
 *  ========================= */
function firstHalfWords(plain = "", capPerItem = 600) {
  if (!plain) return "";
  const words = plain.trim().split(/\s+/);
  const half = Math.ceil(words.length * 0.5);
  return words.slice(0, Math.min(capPerItem, half)).join(" ");
}

async function generateWeeklyBullets(tabName, items) {
  // Build rich context: up to N items, each with ~50% body (capped)
  const CONTEXT_ITEM_LIMIT = 60;     // up to 60 items
  const WORDS_PER_ITEM_CAP = 600;    // cap per item (keeps tokens sane)
  const TOTAL_WORD_BUDGET = 10000;   // soft global cap (~10k words of body text)

  const ctxParts = [];
  let totalWords = 0;
  for (const [i, it] of items.slice(0, CONTEXT_ITEM_LIMIT).entries()) {
    const half = firstHalfWords(it.fullText || it.excerpt || it.snippet || "", WORDS_PER_ITEM_CAP);
    const w = half ? half.trim().split(/\s+/).length : 0;
    if (totalWords + w > TOTAL_WORD_BUDGET) break;
    totalWords += w;

    ctxParts.push(
      `${i + 1}. TITLE: ${it.title}\nSOURCE: ${it.source}\nURL: ${it.url}\nTEXT:\n${half}\n---`
    );
  }
  const context = ctxParts.join("\n");

  if (!process.env.OPENAI_API_KEY) {
    const bullets = items.slice(0, 10).map((it) => ({
      text: `**${it.title}** (${it.source})`,
      url: it.url,
    }));
    return { bullets, note: "fallback (no OPENAI_API_KEY)" };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 🔁 UPDATED PROMPT — Niv is an enthusiast/curator who READ the articles (not the author)
    const system =
      "You are Niv, a concise UK tech & telecoms industry enthusiast and curator. You READ articles from reputable sources and share takeaways; you DID NOT write the original pieces. Produce exactly 10 items. EACH item must be ONE clean sentence in first person ('I'), personable but factual, no emojis, and you may bold KEY TERMS/COMPANIES using **double asterisks**. Do not claim authorship or exclusives. Attribute ideas implicitly (e.g., 'I’m seeing...', 'I noticed...'). Return STRICT JSON only: {\"bullets\":[{\"text\":\"...\",\"urls\":[\"...\"]}, ...]}. 'urls' must come ONLY from the provided items (1–3 per bullet).";
    const user =
      `Create my weekly summary for "${tabName}" based ONLY on this dataset. Each item includes TITLE, SOURCE, URL, and TEXT (~50% of the article body):\n\n${context}`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const raw = resp.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    let bullets;
    if (parsed && Array.isArray(parsed.bullets) && parsed.bullets.length) {
      bullets = parsed.bullets.slice(0, 10).map((b) => ({
        text: String(b.text || "").trim(),
        url: Array.isArray(b.urls) && b.urls[0] ? String(b.urls[0]) : undefined,
      }));
    } else {
      bullets = items.slice(0, 10).map((it) => ({
        text: `**${it.title}** (${it.source})`,
        url: it.url,
      }));
    }

    return { bullets };
  } catch (e) {
    const bullets = items.slice(0, 10).map((it) => ({
      text: `**${it.title}** (${it.source})`,
      url: it.url,
    }));
    return { bullets, note: "fallback (summary generation error)" };
  }
}


/** =========================
 *  SCORING / ORDERING
 *  ========================= */
function annotateHotness(items) {
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
      const pop = Math.log1p(size || 1);
      const age = ageDays(item.publishedAt);
      const recency = Math.max(0, 1.5 - 0.12 * age);
      const analysis = detectTopTake(item.title) ? 0.5 : 0;
      const authority = sourceAuthority(item.source);
      const score = +(1 + pop + recency + analysis + authority).toFixed(3);

      const tags = [...(item.tags || [])];
      if (detectTopTake(item.title)) tags.push("top-take");

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

  const unique = dedupeByUrl(collected);
  const enriched = [];
  for (const it of unique) {
    enriched.push(await addFullText(it));
  }

  const ranked = annotateHotness(enriched);
  await writeJson(`${key}.json`, ranked);

  const summary = await generateWeeklyBullets(key, ranked);
  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SUMMARY_DIR, `${key}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)
  );
  console.log(`wrote summaries/${key}.json (10 bullets)`);
}

async function processCompanyWeekly(company, rssUrls) {
  const collected = [];
  for (const u of rssUrls) {
    const items = await getFeedItems(u);
    collected.push(...items);
  }

  const unique = dedupeByUrl(collected);
  const enriched = [];
  for (const it of unique) {
    enriched.push(await addFullText(it));
  }

  const ranked = annotateHotness(enriched);
  await writeJson(`company/${company}.json`, ranked);

  const summary = await generateWeeklyBullets(`company_${company}`, ranked);
  await fs.mkdir(SUMMARY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(SUMMARY_DIR, `company_${company}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...summary }, null, 2)
  );
  console.log(`wrote summaries/company_${company}.json (10 bullets)`);
}

/** =========================
 *  MAIN
 *  ========================= */
async function main() {
  await processGroupWeekly("hightech", SOURCES.hightech);
  await processGroupWeekly("telecoms", SOURCES.telecoms);
  await processCompanyWeekly("microsoft", COMPANY_RSS.microsoft);
  await processCompanyWeekly("sage", COMPANY_RSS.sage);
}

export async function runAll() {
  await main();
}

// Only run when directly invoked via CLI: `node scripts/ingest.mjs`
import { fileURLToPath } from "node:url";
// reuse the top-level `path` import already in this file
const isDirect =
  process.argv?.[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  runAll().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}


