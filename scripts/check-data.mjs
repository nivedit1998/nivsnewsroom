import fs from "node:fs/promises";
import path from "node:path";
import {
  COMPANY_ALLOWED_HOSTS,
  COMPANY_KEYS,
  FEED_SOURCES,
} from "./news-sources.mjs";
import {
  FINTECH_CONTEXT_LIMIT,
  FINTECH_SUMMARY_PROMPT_VERSION,
  GENERAL_SUMMARY_PROMPT_VERSION,
  INSIGHTS_SCORING_VERSION,
} from "./ingest.mjs";

const ROOT = process.cwd();
const MAX_SUMMARY_BULLETS = 5;
const SCORE_LIMITS = {
  topicFit: 2.4,
  impact: 2.4,
  practicalValue: 1.3,
  novelty: 1.1,
  recency: 0.9,
  authority: 0.2,
  ukRelevance: 0.7,
  crossSource: 0.5,
  penalties: 3,
};
const DATASETS = [
  ["hightech", "public/data/hightech.json", "public/data/summaries/hightech.json"],
  ["telecoms", "public/data/telecoms.json", "public/data/summaries/telecoms.json"],
  ["fintech", "public/data/fintech.json", "public/data/summaries/fintech.json"],
  ...COMPANY_KEYS.map((company) => [
    company,
    "public/data/company/" + company + ".json",
    "public/data/summaries/company_" + company + ".json",
  ]),
];

const REMOVED_FILES = [
  "public/data/company/microsoft.json",
  "public/data/summaries/company_microsoft.json",
];

async function readJson(relativePath) {
  const raw = await fs.readFile(path.join(ROOT, relativePath), "utf8");
  return JSON.parse(raw);
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

const FINTECH_ALLOWED_HOSTS = new Set(
  FEED_SOURCES.fintech.flatMap((source) => source.allowedHosts.map(normaliseHostname))
);

function isCompanyUrlAllowed(company, url) {
  const allowed = COMPANY_ALLOWED_HOSTS[company];
  if (!allowed) return false;
  const host = normaliseHostname(hostnameOf(url));
  return [...allowed].some((candidate) => normaliseHostname(candidate) === host);
}

const errors = [];
let totalItems = 0;

for (const [name, dataPath, summaryPath] of DATASETS) {
  let articles;
  let summary;

  try {
    articles = await readJson(dataPath);
  } catch (error) {
    errors.push(name + ": cannot read or parse " + dataPath + ": " + error.message);
    continue;
  }

  if (!Array.isArray(articles)) {
    errors.push(name + ": " + dataPath + " must contain an array");
    continue;
  }

  totalItems += articles.length;
  const articleUrls = new Set();
  for (const [index, item] of articles.entries()) {
    if (!item || typeof item.title !== "string" || !item.title.trim()) {
      errors.push(name + ": article " + index + " has no title");
    }
    if (typeof item?.source !== "string" || !item.source.trim()) {
      errors.push(name + ": article " + index + " has no source");
    }
    if (typeof item?.url !== "string" || !/^https?:\/\/[^\s]+$/i.test(item.url)) {
      errors.push(name + ": article " + index + " has an invalid absolute URL");
    } else {
      if (articleUrls.has(item.url)) {
        errors.push(name + ": duplicate article URL at index " + index + ": " + item.url);
      }
      articleUrls.add(item.url);
      if (COMPANY_KEYS.includes(name) && !isCompanyUrlAllowed(name, item.url)) {
        errors.push(name + ": article " + index + " URL is outside the company allowlist: " + item.url);
      }
      if (name === "fintech") {
        const host = normaliseHostname(hostnameOf(item.url));
        if (!FINTECH_ALLOWED_HOSTS.has(host)) {
          errors.push(name + ": article " + index + " URL is outside the FinTech source allowlist: " + item.url);
        }
        if (host === "news.google.com" || host === "gov.uk" || host.endsWith(".gov.uk")) {
          errors.push(name + ": article " + index + " uses a disallowed aggregator or GOV.UK URL: " + item.url);
        }
      }
    }
    if (!Number.isFinite(item?.score)) {
      errors.push(name + ": article " + index + " has a non-finite score");
    }
    if (item?.scoringVersion !== INSIGHTS_SCORING_VERSION) {
      errors.push(name + ": article " + index + " has an invalid scoringVersion");
    }
    if (!item?.scoreBreakdown || typeof item.scoreBreakdown !== "object") {
      errors.push(name + ": article " + index + " has no scoreBreakdown");
    } else {
      for (const [field, maximum] of Object.entries(SCORE_LIMITS)) {
        const value = item.scoreBreakdown[field];
        if (!Number.isFinite(value) || value < 0 || value > maximum) {
          errors.push(
            name + ": article " + index + " scoreBreakdown." + field +
            " must be between 0 and " + maximum
          );
        }
      }
      if (item.scoreBreakdown.scoringVersion !== INSIGHTS_SCORING_VERSION) {
        errors.push(name + ": article " + index + " scoreBreakdown has an invalid scoringVersion");
      }
      if (!Number.isInteger(item.scoreBreakdown.groupSize) || item.scoreBreakdown.groupSize < 1) {
        errors.push(name + ": article " + index + " scoreBreakdown has an invalid groupSize");
      }
      if (!Number.isInteger(item.scoreBreakdown.distinctSourceCount) || item.scoreBreakdown.distinctSourceCount < 1) {
        errors.push(name + ": article " + index + " scoreBreakdown has an invalid distinctSourceCount");
      }
    }
    if (index > 0) {
      const previous = articles[index - 1];
      const scoreOrder = Number(previous?.score) - Number(item?.score);
      const previousDate = new Date(previous?.publishedAt || 0).getTime();
      const currentDate = new Date(item?.publishedAt || 0).getTime();
      const tieOrder = previousDate === currentDate
        ? String(item?.url || "").localeCompare(String(previous?.url || ""))
        : previousDate - currentDate;
      if (scoreOrder < 0 || (scoreOrder === 0 && tieOrder < 0)) {
        errors.push(name + ": articles are not sorted by score/date/URL at index " + index);
      }
    }
  }

  try {
    summary = await readJson(summaryPath);
  } catch (error) {
    errors.push(name + ": cannot read or parse " + summaryPath + ": " + error.message);
    continue;
  }

  if (!summary || !Array.isArray(summary.bullets)) {
    errors.push(name + ": " + summaryPath + " must contain a bullets array");
    continue;
  }
  if (summary.bullets.length > MAX_SUMMARY_BULLETS) {
    errors.push(
      name + ": " + summaryPath + " contains " + summary.bullets.length +
      " bullets; maximum is " + MAX_SUMMARY_BULLETS
    );
  }
  if (!summary.generatedAt || !Number.isFinite(Date.parse(summary.generatedAt))) {
    errors.push(name + ": " + summaryPath + " has an invalid generatedAt timestamp");
  }
  if (summary.scoringVersion !== INSIGHTS_SCORING_VERSION) {
    errors.push(name + ": " + summaryPath + " has an invalid scoringVersion");
  }
  const expectedPromptVersion = name === "fintech"
    ? FINTECH_SUMMARY_PROMPT_VERSION
    : GENERAL_SUMMARY_PROMPT_VERSION;
  if (summary.promptVersion !== expectedPromptVersion) {
    errors.push(name + ": " + summaryPath + " has an invalid promptVersion");
  }
  const contextLimit = name === "fintech" ? FINTECH_CONTEXT_LIMIT : MAX_SUMMARY_BULLETS;
  if (!Array.isArray(summary.contextUrls) || summary.contextUrls.length > contextLimit) {
    errors.push(name + ": " + summaryPath + " must record no more than " + contextLimit + " contextUrls");
  }
  const summaryContextUrls = Array.isArray(summary.contextUrls)
    ? new Set(summary.contextUrls)
    : new Set();
  if (summaryContextUrls.size !== (summary.contextUrls || []).length) {
    errors.push(name + ": " + summaryPath + " contains duplicate contextUrls");
  }
  for (const contextUrl of summaryContextUrls) {
    if (!articleUrls.has(contextUrl)) {
      errors.push(name + ": summary context URL is not present in its article dataset: " + contextUrl);
    }
  }
  if (name === "fintech") {
    if (typeof summary.inputHash !== "string" || !summary.inputHash.trim()) {
      errors.push(name + ": " + summaryPath + " has no inputHash cache fingerprint");
    }
  }

  for (const [index, bullet] of summary.bullets.entries()) {
    if (!bullet || typeof bullet.text !== "string" || !bullet.text.trim()) {
      errors.push(name + ": summary bullet " + index + " has no text");
    }
    if (bullet?.url && !/^https?:\/\/[^\s]+$/i.test(bullet.url)) {
      errors.push(name + ": summary bullet " + index + " has an invalid absolute URL");
    }
    if (bullet?.url && !articleUrls.has(bullet.url)) {
      errors.push(name + ": summary bullet " + index + " URL is not present in its article dataset");
    }
    if (bullet?.url && !summaryContextUrls.has(bullet.url)) {
      errors.push(name + ": summary bullet " + index + " URL is outside the permitted summary context");
    }
  }

  console.log(name + ": " + articles.length + " articles, " + summary.bullets.length + " bullets");
}

for (const relativePath of REMOVED_FILES) {
  try {
    await fs.access(path.join(ROOT, relativePath));
    errors.push("removed Microsoft file still exists: " + relativePath);
  } catch {
    // Expected after the company replacement.
  }
}

if (totalItems === 0) {
  errors.push("all content datasets are empty");
}

if (errors.length) {
  console.error("Data validation failed:");
  for (const error of errors) console.error("- " + error);
  process.exit(1);
}

console.log("Data validation passed (" + totalItems + " total articles).");
