import assert from "node:assert/strict";
import {
  FINTECH_CONTEXT_LIMIT,
  FINTECH_SUMMARY_PROMPT_VERSION,
  FINTECH_WORDS_PER_ITEM_CAP,
  GENERAL_SUMMARY_PROMPT_VERSION,
  INSIGHTS_SCORING_VERSION,
  annotateHotness,
  buildSummaryInputHash,
  generateWeeklyBullets,
  scoreItem,
  selectFintechContext,
  selectSummaryContext,
  shouldPreservePrevious,
} from "./ingest.mjs";

const NOW = "2026-08-26T12:00:00.000Z";

function item(overrides = {}) {
  return {
    title: "Useful technology development",
    source: "techcrunch.com",
    url: "https://techcrunch.com/article",
    publishedAt: "2026-08-25T12:00:00.000Z",
    snippet: "A concrete technology development affects customers and businesses.",
    excerpt: "",
    fullText: "",
    ...overrides,
  };
}

function score(article, context = "hightech", options = {}) {
  return scoreItem(article, 1, context, { now: NOW, ...options });
}

const rollout = score(item({
  title: "6G network rollout improves coverage for 5 million customers",
  source: "rcrwireless.com",
  url: "https://rcrwireless.com/6g-rollout",
  publishedAt: "2026-08-24T12:00:00.000Z",
  snippet: "The commercial deployment expands mobile network coverage and capacity for customers.",
}), "telecoms");

const genericPartnership = score(item({
  title: "Company announces exciting partnership",
  source: "techcrunch.com",
  url: "https://techcrunch.com/partnership",
  publishedAt: "2026-08-26T11:00:00.000Z",
  snippet: "The companies announced a collaboration with no specific product or customer change.",
}), "telecoms");
assert.ok(rollout.score > genericPartnership.score, "material rollout should outrank a generic partnership");

const regulation = score(item({
  title: "FCA approves new open banking rule for UK payments",
  source: "fca.org.uk",
  url: "https://fca.org.uk/news/open-banking-rule",
  publishedAt: "2026-08-24T12:00:00.000Z",
  snippet: "The regulatory decision changes compliance requirements for payment providers.",
}), "fintech");

const appointment = score(item({
  title: "Company appoints new executive",
  source: "techcrunch.com",
  url: "https://techcrunch.com/appointment",
  publishedAt: "2026-08-26T11:00:00.000Z",
  snippet: "The company announced a leadership appointment.",
}), "fintech");
assert.ok(regulation.score > appointment.score, "regulatory change should outrank a routine appointment");

const launch = score(item({
  title: "New smartphone launches with faster processing",
  source: "theverge.com",
  url: "https://theverge.com/new-smartphone",
  snippet: "The product launch gives customers a faster device.",
}), "hightech");

const hype = score(item({
  title: "Exciting innovation promises a better future",
  source: "theverge.com",
  url: "https://theverge.com/exciting-innovation",
  snippet: "The company described an exciting innovation without a concrete change.",
}), "hightech");
assert.ok(launch.score > hype.score, "concrete launch should outrank vague hype");

const analysisTitle = score(item({
  title: "AI model launches analysis",
  url: "https://techcrunch.com/ai-analysis",
}), "hightech");
const plainTitle = score(item({
  title: "AI model launches",
  url: "https://techcrunch.com/ai-launch",
}), "hightech");
assert.equal(analysisTitle.breakdown.analysis, undefined, "analysis must not be a score component");
assert.equal(analysisTitle.score, plainTitle.score, "analysis label must not receive an automatic bonus");

const featureTitle = score(item({
  title: "Quantum processor feature",
  url: "https://theverge.com/quantum-feature",
}), "hightech");
const processorTitle = score(item({
  title: "Quantum processor",
  url: "https://theverge.com/quantum-processor",
}), "hightech");
assert.equal(featureTitle.score, processorTitle.score, "feature label must not receive an automatic bonus");

const sameSource = score(item({
  title: "6G network rollout expands coverage",
  source: "rcrwireless.com",
  url: "https://rcrwireless.com/rollout-a",
}), "telecoms", { sourceCount: 1 });
const crossSource = score(item({
  title: "6G network rollout expands coverage",
  source: "gsma.com",
  url: "https://gsma.com/rollout-b",
}), "telecoms", { sourceCount: 2 });
assert.equal(sameSource.breakdown.crossSource, 0);
assert.equal(crossSource.breakdown.crossSource, 0.25);

const freshWeak = score(item({
  title: "Company announces exciting update",
  source: "techcrunch.com",
  url: "https://techcrunch.com/weak-update",
  publishedAt: "2026-08-26T11:00:00.000Z",
  snippet: "A company update was shared.",
}), "telecoms");
const olderStrong = score(item({
  title: "5G network rollout improves coverage for customers",
  source: "rcrwireless.com",
  url: "https://rcrwireless.com/strong-rollout",
  publishedAt: "2026-08-24T12:00:00.000Z",
  snippet: "The deployment expands mobile network coverage and capacity for customers.",
}), "telecoms");
assert.ok(olderStrong.score > freshWeak.score, "freshness alone must not beat strong topic and impact signals");

const globalImpact = score(item({
  title: "Global 5G outage disrupts 100 million users",
  source: "theverge.com",
  url: "https://theverge.com/global-outage",
  publishedAt: "2026-08-25T12:00:00.000Z",
  snippet: "A major service failure affects users across multiple markets.",
}), "telecoms");
const ukRoutine = score(item({
  title: "UK telecoms company announces exciting partnership",
  source: "telecomstechnews.com",
  url: "https://telecomstechnews.com/uk-partnership",
  publishedAt: "2026-08-26T11:00:00.000Z",
  snippet: "The companies announced a collaboration.",
}), "telecoms");
assert.ok(globalImpact.score > ukRoutine.score, "UK relevance must not override materially greater global impact");

const lowSignal = score(item({
  title: "Telecoms careers and jobs",
  source: "totaltele.com",
  url: "https://totaltele.com/jobs/telecoms-careers",
}), "telecoms");
assert.equal(lowSignal.breakdown.penalties, 2.5, "low-signal content should receive the hard ranking penalty");

const companyItem = score(item({
  title: "New platform services for clients",
  source: "capco.com",
  url: "https://capco.com/intelligence/platform-services",
}), "company_capco");
assert.equal(companyItem.breakdown.topicFit, 1.3, "company content should receive a relevance baseline");

const boundedFields = [
  ["topicFit", 2.4],
  ["impact", 2.4],
  ["practicalValue", 1.3],
  ["novelty", 1.1],
  ["recency", 0.9],
  ["authority", 0.2],
  ["ukRelevance", 0.7],
  ["crossSource", 0.5],
  ["penalties", 3],
];
for (const [field, maximum] of boundedFields) {
  assert.ok(rollout.breakdown[field] <= maximum, field + " exceeds its bound");
}

const ranked = annotateHotness([
  item({ title: "6G network rollout improves coverage", source: "cnet.com", url: "https://cnet.com/a" }),
  item({ title: "6G network rollout improves coverage", source: "cnet.com", url: "https://cnet.com/b" }),
  item({ title: "AI model launches", source: "techcrunch.com", url: "https://techcrunch.com/c" }),
], "telecoms", { now: NOW });
assert.equal(ranked[0].scoringVersion, INSIGHTS_SCORING_VERSION);
assert.equal(ranked[0].scoreBreakdown.scoringVersion, INSIGHTS_SCORING_VERSION);
assert.equal(ranked[0].scoreBreakdown.groupSize, 2);
assert.equal(ranked[0].scoreBreakdown.distinctSourceCount, 1);
for (let index = 1; index < ranked.length; index += 1) {
  assert.ok(ranked[index - 1].score >= ranked[index].score, "ranked data must be score-descending");
}

const contextItems = [
  item({ title: "AI chips launch", source: "cnet.com", url: "https://cnet.com/context-1" }),
  item({ title: "Quantum computing milestone", source: "cnet.com", url: "https://cnet.com/context-2" }),
  item({ title: "AI chips launch", source: "techcrunch.com", url: "https://techcrunch.com/context-3" }),
  item({ title: "Robotics platform expands", source: "techcrunch.com", url: "https://techcrunch.com/context-4" }),
  item({ title: "Cloud security update", source: "theverge.com", url: "https://theverge.com/context-5" }),
  item({ title: "Battery breakthrough", source: "theverge.com", url: "https://theverge.com/context-6" }),
];
const summaryContext = selectSummaryContext(contextItems, 5);
assert.equal(summaryContext.length, 5);
assert.ok(summaryContext.filter((entry) => entry.source === "cnet.com").length <= 2);
assert.equal(summaryContext.filter((entry) => entry.title === "AI chips launch").length, 1);

const companyContext = selectSummaryContext(contextItems, 5, { diverse: false });
assert.deepEqual(companyContext, contextItems.slice(0, 5));

const fintechContext = selectFintechContext(Array.from({ length: 15 }, (_, index) => item({
  title: "FinTech payments development " + index,
  source: ["finextra.com", "pymnts.com", "fca.org.uk", "paymentsdive.com"][index % 4],
  url: "https://" + ["finextra.com", "pymnts.com", "fca.org.uk", "paymentsdive.com"][index % 4] + "/fintech-" + index,
})));
assert.equal(fintechContext.length, FINTECH_CONTEXT_LIMIT);
assert.ok(
  [...new Set(fintechContext.map((entry) => entry.source))].every((source) =>
    fintechContext.filter((entry) => entry.source === source).length <= 3
  )
);

const hashContext = summaryContext.slice(0, 3);
const stableHash = buildSummaryInputHash(hashContext);
assert.equal(stableHash, buildSummaryInputHash(hashContext));
assert.notEqual(
  stableHash,
  buildSummaryInputHash(hashContext, { promptVersion: "changed-prompt" })
);
assert.notEqual(
  stableHash,
  buildSummaryInputHash(hashContext, { scoringVersion: "changed-scoring" })
);
assert.equal(FINTECH_SUMMARY_PROMPT_VERSION, "fintech-insights-v2");
assert.equal(GENERAL_SUMMARY_PROMPT_VERSION, "insights-v2");
assert.equal(FINTECH_WORDS_PER_ITEM_CAP, 400);

assert.equal(shouldPreservePrevious([{ title: "old" }], []), true);
assert.equal(shouldPreservePrevious([], []), false);
assert.equal(shouldPreservePrevious([{ title: "old" }], [{ title: "new" }]), false);

const emptySageSummary = await generateWeeklyBullets("company_sage", []);
assert.deepEqual(emptySageSummary.bullets, []);
assert.equal(emptySageSummary.scoringVersion, INSIGHTS_SCORING_VERSION);
assert.equal(emptySageSummary.promptVersion, GENERAL_SUMMARY_PROMPT_VERSION);
assert.deepEqual(emptySageSummary.contextUrls, []);

console.log("Better insights scoring and context tests passed.");
