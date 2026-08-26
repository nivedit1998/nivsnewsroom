import fs from "node:fs/promises";
import path from "node:path";
import { COMPANY_ALLOWED_HOSTS, COMPANY_KEYS } from "./news-sources.mjs";

const ROOT = process.cwd();
const MAX_SUMMARY_BULLETS = 5;
const DATASETS = [
  ["hightech", "public/data/hightech.json", "public/data/summaries/hightech.json"],
  ["telecoms", "public/data/telecoms.json", "public/data/summaries/telecoms.json"],
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
  const rankedTopUrls = new Set(articles.slice(0, MAX_SUMMARY_BULLETS).map((item) => item?.url).filter(Boolean));
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
    if (bullet?.url && !rankedTopUrls.has(bullet.url)) {
      errors.push(name + ": summary bullet " + index + " URL is outside the ranked top five");
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
