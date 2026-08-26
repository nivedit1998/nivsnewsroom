import assert from "node:assert/strict";
import {
  FEED_SOURCES,
} from "./news-sources.mjs";
import {
  FINTECH_CONTEXT_LIMIT,
  FINTECH_MAX_ITEMS_PER_SOURCE,
  FINTECH_SUMMARY_OUTPUT_LIMIT,
  FINTECH_SUMMARY_PROMPT_VERSION,
  FINTECH_WORDS_PER_ITEM_CAP,
  INSIGHTS_SCORING_VERSION,
  annotateHotness,
  buildSummaryInputHash,
  filterFintechItems,
  selectFintechContext,
} from "./ingest.mjs";

const expectedLabels = [
  "Finextra Payments",
  "The FinTech Times",
  "Open Banking Limited",
  "Financial Conduct Authority",
  "Payments Dive",
  "PYMNTS",
];

assert.deepEqual(
  FEED_SOURCES.fintech.map((source) => source.label),
  expectedLabels,
  "FinTech source registry should contain only the approved six sources"
);
assert.equal(FEED_SOURCES.fintech.length, 6);
assert.ok(FEED_SOURCES.fintech.every((source) => source.maxItems === FINTECH_MAX_ITEMS_PER_SOURCE));
assert.ok(FEED_SOURCES.fintech.every((source) => !/news\.google\.com|gov\.uk/i.test(source.url)));

const fixtureSources = [
  "finextra.com",
  "thefintechtimes.com",
  "openbanking.org.uk",
  "fca.org.uk",
  "paymentsdive.com",
  "pymnts.com",
];
const fixtureItems = Array.from({ length: 12 }, (_, index) => ({
  title: `FinTech payments development ${index + 1}`,
  url: `https://${fixtureSources[index % fixtureSources.length]}/article-${index + 1}`,
  source: fixtureSources[index % fixtureSources.length],
  publishedAt: "2026-08-26T08:00:00.000Z",
  excerpt: "Payments and digital wallet technology are changing financial services.",
}));

fixtureItems.push(
  {
    title: "General bank rate unchanged",
    url: "https://example.com/bank-rate",
    source: "example.com",
    publishedAt: "2026-08-26T08:00:00.000Z",
    excerpt: "A general macroeconomic update without a technology angle.",
  },
  {
    title: "Payments podcast job listing",
    url: "https://finextra.com/jobs/podcast",
    source: "finextra.com",
    publishedAt: "2026-08-26T08:00:00.000Z",
    excerpt: "Careers and job openings.",
  },
  {
    title: "FCA unauthorised firm warning list",
    url: "https://fca.org.uk/news/warning-list",
    source: "fca.org.uk",
    publishedAt: "2026-08-26T08:00:00.000Z",
    excerpt: "Unauthorised firm warning list.",
  },
  {
    title: "Embedded accounting event",
    url: "https://finextra.com/event-info/626/embedded-accounting",
    source: "finextra.com",
    publishedAt: "2026-08-26T08:00:00.000Z",
    excerpt: "An event information page.",
  }
);

const filtered = filterFintechItems(fixtureItems);
assert.equal(filtered.length, 12, "irrelevant and excluded FinTech items should be removed");

const context = selectFintechContext(filtered);
assert.equal(context.length, FINTECH_CONTEXT_LIMIT, "AI context must be capped at 10 articles");
const perSource = new Map();
for (const item of context) {
  const count = (perSource.get(item.source) || 0) + 1;
  perSource.set(item.source, count);
}
assert.ok([...perSource.values()].every((count) => count <= 3), "context should prefer source diversity");

const hash = buildSummaryInputHash(context);
assert.match(hash, /^[a-f0-9]{64}$/, "summary input fingerprint should be SHA-256");
assert.equal(hash, buildSummaryInputHash(context), "same context should produce the same fingerprint");
assert.notEqual(
  hash,
  buildSummaryInputHash(context.map((item, index) => index === 0 ? { ...item, title: item.title + " changed" } : item)),
  "changed context should invalidate the fingerprint"
);

assert.equal(FINTECH_SUMMARY_OUTPUT_LIMIT, 5);
assert.equal(FINTECH_WORDS_PER_ITEM_CAP, 400);
assert.equal(FINTECH_SUMMARY_PROMPT_VERSION, "fintech-insights-v2");

const ranked = annotateHotness(filtered, "fintech", {
  now: "2026-08-26T12:00:00.000Z",
});
assert.ok(ranked.every((item) => item.scoringVersion === INSIGHTS_SCORING_VERSION));
assert.ok(ranked.every((item) => item.scoreBreakdown?.scoringVersion === INSIGHTS_SCORING_VERSION));
assert.notEqual(ranked[0].scoreBreakdown?.topicFit, undefined);

const changedDate = context.map((item, index) =>
  index === 0 ? { ...item, publishedAt: "2026-08-25T12:00:00.000Z" } : item
);
assert.notEqual(
  hash,
  buildSummaryInputHash(changedDate),
  "changed publication date should invalidate the fingerprint"
);
assert.notEqual(
  hash,
  buildSummaryInputHash(context, { scoringVersion: "changed-scoring" }),
  "changed scoring version should invalidate the fingerprint"
);
console.log("FinTech helper tests passed.");
