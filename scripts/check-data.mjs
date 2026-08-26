import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATASETS = [
  ["hightech", "public/data/hightech.json", "public/data/summaries/hightech.json"],
  ["telecoms", "public/data/telecoms.json", "public/data/summaries/telecoms.json"],
  ["microsoft", "public/data/company/microsoft.json", "public/data/summaries/company_microsoft.json"],
  ["sage", "public/data/company/sage.json", "public/data/summaries/company_sage.json"],
];

async function readJson(relativePath) {
  const raw = await fs.readFile(path.join(ROOT, relativePath), "utf8");
  return JSON.parse(raw);
}

const errors = [];
let totalItems = 0;

for (const [name, dataPath, summaryPath] of DATASETS) {
  let articles;
  let summary;

  try {
    articles = await readJson(dataPath);
  } catch (error) {
    errors.push(`${name}: cannot read or parse ${dataPath}: ${error.message}`);
    continue;
  }

  if (!Array.isArray(articles)) {
    errors.push(`${name}: ${dataPath} must contain an array`);
    continue;
  }

  totalItems += articles.length;
  const articleUrls = new Set();
  for (const [index, item] of articles.entries()) {
    if (!item || typeof item.title !== "string" || !item.title.trim()) {
      errors.push(`${name}: article ${index} has no title`);
    }
    if (typeof item?.url !== "string" || !/^https?:\/\/[^\s]+$/i.test(item.url)) {
      errors.push(`${name}: article ${index} has an invalid absolute URL`);
    } else {
      articleUrls.add(item.url);
    }
  }

  try {
    summary = await readJson(summaryPath);
  } catch (error) {
    errors.push(`${name}: cannot read or parse ${summaryPath}: ${error.message}`);
    continue;
  }

  if (!summary || !Array.isArray(summary.bullets)) {
    errors.push(`${name}: ${summaryPath} must contain a bullets array`);
    continue;
  }
  if (!summary.generatedAt || !Number.isFinite(Date.parse(summary.generatedAt))) {
    errors.push(`${name}: ${summaryPath} has an invalid generatedAt timestamp`);
  }

  for (const [index, bullet] of summary.bullets.entries()) {
    if (!bullet || typeof bullet.text !== "string" || !bullet.text.trim()) {
      errors.push(`${name}: summary bullet ${index} has no text`);
    }
    if (bullet?.url && !articleUrls.has(bullet.url)) {
      errors.push(`${name}: summary bullet ${index} URL is not present in its article dataset`);
    }
  }

  console.log(`${name}: ${articles.length} articles, ${summary.bullets.length} bullets`);
}

if (totalItems === 0) {
  errors.push("all content datasets are empty");
}

if (errors.length) {
  console.error("Data validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Data validation passed (${totalItems} total articles).`);
