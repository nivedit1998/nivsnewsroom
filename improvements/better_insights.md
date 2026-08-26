# Better Insights: Implementation Plan

**Status:** Planned; not implemented
**Prepared:** 26 August 2026
**Repository:** NivsNewsRoom
**Scope:** Improve article ranking and make the saved AI summaries easier for non-specialist readers, without adding AI scoring calls or changing the number of summary requests.

## 1. Intended outcome

The site should surface stories that are more likely to be genuinely useful and interesting, rather than stories that are merely new, duplicated across feeds, or labelled as analysis.

The revised system should:

- Prioritise meaningful change, real-world impact, novelty, practical relevance, and category fit.
- Keep UK relevance as a useful preference, but stop it from overwhelming editorial importance.
- Reduce the influence of source authority and publication freshness so they act as tie-breakers.
- Stop automatically rewarding titles containing words such as "analysis", "feature", "review", or "interview".
- Penalise low-signal content such as jobs, events, webinars, podcasts, generic corporate announcements, and vague marketing copy.
- Reward corroboration across different publishers only when the stories are genuinely similar; repeated copies from one source must not look popular.
- Prevent one publisher from filling the entire AI context when there is enough material from other sources.
- Explain technical stories for intelligent beginners without assuming telecoms, technology, or FinTech knowledge.
- Explain acronyms and specialist terms on first use where they are important to understanding the story.
- Make every insight answer, in compact form: what happened, why it matters, and who may be affected.
- Keep the existing maximum of five saved insights per category.
- Keep the existing maximum of ten FinTech context articles.
- Keep the existing maximum of one AI summary request per content group per ingestion run.
- Keep the LinkedIn page using saved summaries only; it must not make a new AI request.

The change is deliberately designed as a deterministic ranking improvement plus a better prompt. AI should explain the selected stories, not score every article.

## 2. Current behaviour and problem

### 2.1 Current ranking

The main ranking logic is in scripts/ingest.mjs, in scoreItem and annotateHotness.

The current score is effectively:

    score = 1
      + log(1 + exact-normalised-title-group-size)
      + recency
      + analysis-or-feature boost
      + source authority
      + UK relevance

The current components have these characteristics:

- Recency can contribute up to 1.5 points.
- Exact or near-exact normalised headline repetition contributes a popularity-like boost, although it is not reader engagement data.
- Titles containing "opinion", "analysis", "explainer", "column", "editorial", "interview", "feature", or "review" receive a 0.5 point boost.
- Source authority is a small fixed value defined in scripts/news-sources.mjs.
- UK relevance can contribute up to 2.2 points through domains, keywords, and UK telecoms or FinTech terms.
- There is no explicit score for impact, novelty, usefulness, or category-specific importance.
- High Tech and Telecoms do not have a strong story-level topic relevance filter after source collection.

This means a fresh article from a trusted UK source, especially one labelled as analysis or feature, can outrank a more consequential story. A repeated headline may also be treated as popularity even though the code has no reader-view or engagement data.

### 2.2 Current AI behaviour

The AI summary logic is also in scripts/ingest.mjs, in generateWeeklyBullets.

- High Tech receives the top five ranked articles.
- Telecoms receives the top five ranked articles.
- Each company-specific section receives the top five ranked articles.
- FinTech receives up to ten ranked articles, with a maximum of three from one source where enough sources are available.
- Each group uses one summary request at most.
- The model is gpt-4o-mini.
- The request has max_completion_tokens: 400.
- The output is capped at five bullets.
- If the key is absent or the request fails, deterministic fallback bullets are used.
- The homepage, API, and LinkedIn page read saved JSON and do not call AI.

The current prompt asks for concise editorial bullets, but it does not explicitly require plain-English explanations, acronym expansion, or a clear explanation of why a story matters. It also tells the model to summarise each supplied article, so it cannot repair a poor selection that happened during ranking.

## 3. Non-goals

This plan does not:

- Add AI scoring for every article.
- Add a second AI call for the LinkedIn page.
- Increase the FinTech context limit above ten.
- Increase the saved summary limit above five.
- Add new news sources.
- Reintroduce GOV.UK.
- Change the approved FinTech source list.
- Change the site navigation or page layout.
- Change the copy-ready LinkedIn plain-text rules.
- Replace the existing article extraction process with AI.
- Add reader accounts, likes, views, or engagement tracking.

## 4. Editorial definition of “interesting”

The ranking should use this working definition:

> An interesting story is one involving a meaningful change, real-world consequence, important breakthrough, material regulatory development, major market shift, or useful practical development for UK-focused technology, telecoms, or FinTech readers.

When two articles are otherwise similar:

1. Prefer the article with clearer impact.
2. Then prefer the article with stronger category fit.
3. Then prefer the article with greater practical relevance.
4. Then prefer cross-source corroboration.
5. Then prefer UK relevance.
6. Then prefer the more authoritative source.
7. Then prefer the newest article.

This ordering makes freshness and publisher authority useful tie-breakers rather than the main definition of importance.

## 5. Proposed ranking model

### 5.1 New score shape

Replace the current pop + recency + analysis + authority + ukBoost calculation with:

    score = 1
      + topicFit
      + impact
      + practicalValue
      + novelty
      + recency
      + authority
      + ukRelevance
      + crossSource
      - penalties

The individual components must be bounded as follows:

| Component | Maximum | Purpose |
| --- | ---: | --- |
| topicFit | 2.4 | Does the story clearly belong to the selected category? |
| impact | 2.4 | Could this materially affect users, businesses, operators, regulators, markets, or the direction of the industry? |
| practicalValue | 1.3 | Does the article make a concrete change understandable or useful to readers? |
| novelty | 1.1 | Is there a launch, first, milestone, rollout, trial, breakthrough, decision, or other clear change? |
| recency | 0.9 | Keeps the seven-day feed timely without overpowering significance. |
| authority | 0.2 | Gives a small advantage to established or primary sources. |
| ukRelevance | 0.7 | Favors UK-specific or UK-facing stories without excluding global stories. |
| crossSource | 0.5 | Rewards independent coverage of the same underlying development. |
| penalties | 3.0 maximum | Down-ranks low-signal, routine, promotional, or unsuitable content. |

The resulting score is still stored as a number and sorted descending. Scores do not need to be presented to visitors.

### 5.2 Topic fit

Add category-specific term profiles in scripts/ingest.mjs. Matching must be case-insensitive and use word or phrase boundaries to avoid accidental matches.

High Tech terms should cover:

- artificial intelligence, AI, machine learning, generative AI, models, agents
- chips, semiconductors, processors, GPUs, advanced packaging
- quantum computing
- robotics and automation
- cloud computing, data centres, software platforms
- cybersecurity, privacy, identity, and security technology
- electric vehicles, batteries, autonomous vehicles
- consumer devices, phones, computers, wearables, mixed reality, and smart home technology

Telecoms terms should cover:

- 5G, 6G, mobile networks, network infrastructure, telecoms, connectivity
- spectrum, radio access network, Open RAN, core network, edge computing
- fibre or fiber, broadband, full fibre, fixed wireless access
- satellite connectivity, direct-to-device, non-terrestrial networks
- Wi-Fi, private networks, network APIs, and network automation
- Internet of Things, IoT, roaming, coverage, capacity, and latency

FinTech should reuse the existing approved FinTech topic vocabulary, including:

- payments, payment infrastructure, digital wallets, open banking, open finance
- embedded finance, banking as a service, real-time payments, account-to-account
- neobanks, digital banking, lending technology, BNPL
- merchant services, acquiring, fraud prevention, identity, financial crime
- regtech, wealthtech, insurtech, stablecoins, tokenisation, digital assets
- AI used in banking or payments

Company-specific sections should not be penalised merely because their titles do not contain a category term. Their approved first-party source allowlists already establish relevance. They should receive a neutral category-fit baseline, with an additional fit signal when the company or a material company product is mentioned.

Recommended scoring implementation:

- Add 1.0 point when a strong category phrase occurs in the title.
- Add 0.5 points when a category phrase occurs in the excerpt or first bounded section of article text.
- Add 0.3 points when a second distinct category phrase occurs.
- Add a company-specific baseline of 1.0 for company_accenture, company_capco, and company_sage.
- Cap the result at the component maximum of 2.4.

Do not make topic fit a hard exclusion for High Tech or Telecoms in this change. It should improve ordering while allowing a relevant story with an unusual headline to remain available.

### 5.3 Impact

Impact should be calculated from concrete signals, with title matches weighted more strongly than body-only matches. Use a bounded helper such as impactSignal.

High-impact signals:

- regulation, regulatory decision, rule, approval, mandate, ban, enforcement, or major compliance change
- major outage, disruption, breach, cyber incident, safety incident, or service failure
- acquisition, merger, major investment, market exit, market entry, or material commercial shift
- launch or rollout affecting a large customer base, national network, major platform, or important infrastructure
- major adoption or scale milestone involving users, devices, coverage, capacity, revenue, or market share
- first commercial deployment, breakthrough, successful test, or production availability

Medium-impact signals:

- new product or service with a clearly described user or business effect
- meaningful network expansion, coverage, performance, or pricing change
- a partnership that introduces a concrete capability or changes distribution
- a trial or pilot with a credible path to deployment

Scoring:

- Strong impact phrase in the title: 1.2 points.
- Strong impact phrase in the text only: 0.7 points.
- Medium impact phrase in the title: 0.7 points.
- Medium impact phrase in the text only: 0.35 points.
- Concrete scale, user, coverage, device, or market number: 0.4 points.
- Cap at 2.4 points.

Do not award impact merely because a headline says “major”, “exciting”, “leading”, or “game-changing”. Those are marketing language, not evidence.

### 5.4 Practical value

Give a small score when the story tells readers how a development affects:

- consumers or customers
- businesses or merchants
- developers or technology teams
- operators or network users
- regulators or compliance teams
- security, privacy, prices, coverage, speed, access, or reliability

Scoring:

- Concrete affected audience or user consequence in the title: 0.6 points.
- Concrete affected audience or consequence in the text: 0.35 points.
- Specific change to price, coverage, availability, speed, security, access, or capability: 0.4 points.
- Cap at 1.3 points.

### 5.5 Novelty and change

Add points for concrete change words and milestones:

- launches, introduces, unveils, releases, deploys, rolls out
- approves, adopts, requires, bans, changes, signs off
- first, first commercial, milestone, surpasses, reaches, becomes
- tests, trials, pilots, demonstrates, achieves
- acquires, merges, enters, exits, expands, opens

Scoring:

- Clear change verb in the title: 0.6 points.
- Milestone or first-of-its-kind phrase in the title: 0.5 points.
- Change or milestone supported by article text only: 0.25 points.
- Cap at 1.1 points.

The existing detectTopTake helper must no longer add a positive score. The analysis, feature, review, interview, and explainer labels may remain as tags for diagnostics, but format alone is not evidence of interest.

### 5.6 Recency

Replace the current maximum 1.5-point recency contribution with:

    recency = max(0, 0.9 - (0.09 * ageDays))

This gives a fresh article 0.9 points and an article seven days old approximately 0.27 points. It is still useful for freshness, but it cannot overwhelm an article with stronger impact signals.

The calculation must continue using Europe/London and the existing LOOKBACK_DAYS environment setting.

### 5.7 Authority

Keep SOURCE_AUTHORITY in scripts/news-sources.mjs, including the approved FinTech source values.

Change the score contribution to:

    authority = min(0.2, sourceAuthority(item.source) * 0.5)

This preserves the source-quality preference while preventing a publisher score from overpowering story-level relevance. Do not use source authority as a substitute for impact.

### 5.8 UK relevance

Keep the existing UK domain and keyword detection, including UK FinTech signals.

Normalise the existing raw UK signal before adding it to the score:

    ukRelevance = min(0.7, (ukSignals(item, context) / 2.2) * 0.7)

This retains a preference for UK and UK-facing stories but limits its ability to push a low-impact story above a materially more important global development.

The existing [UK-relevant] marker in the AI context should continue to use the same detection.

### 5.9 Cross-source corroboration

Keep groupSize in the generated article data for compatibility, but stop treating every same-source duplicate as popularity.

For each normalised title group:

- Count distinct source hostnames, not just article count.
- Add 0.25 points when the same normalised story appears from two different sources.
- Add another 0.25 points when it appears from three or more different sources.
- Add no cross-source points for repeated items from the same publisher.
- Cap at 0.5 points.

If two sources use substantially different headlines for the same story, the existing exact normalisation may not detect it. Do not add an AI deduplication pass in this change. A later deterministic similarity improvement can be considered after reviewing the new ranking output.

### 5.10 Penalties

Add a bounded penalties helper. Penalties should lower ranking, not silently delete an article, unless the existing category/source filter already excludes it.

Low-signal content:

- jobs, careers, vacancies, recruitment
- event pages, conference listings, webinars, podcasts
- author, tag, archive, category, or navigation pages

Apply 2.5 points for an unmistakable low-signal title or URL path. The existing FinTech hard filtering remains responsible for removing these items from the FinTech dataset.

Routine corporate content:

- appointments, hires, leadership changes
- generic partnership or collaboration announcements
- sponsorships or awards
- generic quarterly or annual results
- vague “announces” stories without a concrete technology, service, regulatory, adoption, or market change

Apply 0.6 points when the title is routine corporate content. Apply 1.0 point when it is routine corporate content and has no positive impact or novelty signal.

Promotional language:

- world-leading, game-changing, revolutionary, exciting, cutting-edge, next-generation
- “proud to announce” or similar promotional phrasing

Apply 0.2 points when promotional language appears without concrete impact evidence. Do not penalise a substantive article merely because a quoted company uses promotional language.

Opinion and analysis:

- Do not apply a penalty solely because an article is an opinion, analysis, feature, interview, review, or explainer.
- Remove the existing automatic +0.5 boost.

The final penalty must be capped at 3.0 so that an item remains inspectable and the score cannot become unexpectedly negative.

## 6. Summary context selection

### 6.1 General categories

Add a helper in scripts/ingest.mjs named selectSummaryContext(items, limit, options).

For High Tech and Telecoms:

- Select at most five articles.
- Walk the ranked list in order.
- Prefer no more than two articles from one source when at least three sources are available.
- Skip a second article with the same normalised title when an alternative ranked story is available.
- Fill any remaining slots from the next highest-ranked articles.
- Never return more than five items.

For company-specific categories:

- Continue using the top five ranked company articles.
- Do not impose a source-diversity cap because each company may have only one or two approved first-party sources.

For FinTech:

- Keep using selectFintechContext.
- Preserve the maximum of ten items and maximum of three items per source.

The selection helper changes which articles are sent to an existing AI call; it does not increase the number of calls or the maximum number of context items.

### 6.2 Summary metadata

Store the selected context URLs in every summary file, not only FinTech:

    contextUrls: summaryItems.map((item) => item.url).filter(Boolean)

Also store:

    scoringVersion: "insights-v2"
    promptVersion: "insights-v2"

Use promptVersion: "fintech-insights-v2" for the FinTech summary if a separate FinTech prompt string is retained.

This makes it possible to audit why a bullet was generated and prevents validation from assuming that every summary bullet must refer to the first five raw ranked records.

## 7. Beginner-friendly AI prompt

### 7.1 Prompt requirements

Update both the general prompt and the FinTech-specific prompt in generateWeeklyBullets.

The prompt must instruct the model to:

- Assume the reader is intelligent but not a specialist.
- Use only the supplied article context.
- Never invent facts, numbers, companies, dates, or implications.
- Explain an acronym or specialist term in plain English at first use when it matters.
- Say what changed and why it matters.
- Mention who may be affected when the supplied context supports it.
- Avoid assuming that the reader already knows the company, technology, regulation, or market.
- Avoid empty phrases such as “this marks a significant step” unless the concrete significance follows.
- Avoid company marketing language and exaggerated claims.
- Prefer a clear practical explanation over a technically impressive but unexplained phrase.
- Keep the existing punchy lead style.
- Keep the output to a maximum of five bullets.
- Keep the existing strict JSON response shape.
- Use only URLs supplied in the context.

The existing optional homepage bold markers may remain supported. The LinkedIn page must continue stripping Markdown markers before display and copy, as it does now.

### 7.2 Proposed general system prompt

Use the following content, adapted to the existing JavaScript array and JSON request:

    You are Niv, a concise UK tech, telecoms, and innovation curator.
    Write for an intelligent beginner who may not know specialist terms.
    Use a crisp, useful editorial tone. No first-person. No “I saw”, “I read”, or “I learned”.
    Use ONLY the supplied articles. Do not invent facts, numbers, dates, causes, or consequences.
    Choose the most meaningful supplied stories and return no more than five bullets.
    Every bullet must explain what happened and why it matters in plain English.
    Mention who may be affected when the supplied context supports it.
    Expand important acronyms or technical terms at first use, briefly.
    Avoid jargon, generic AI language, empty hype, and company marketing claims.
    Each bullet starts with a clear PUNCH LEAD of 2–5 words in Title Case.
    Follow the lead with an em dash and one concise sentence of no more than 28 words.
    You may use **double asterisks** for a small number of key terms.
    Return STRICT JSON only: {"bullets":[{"text":"...","urls":["..."]}, ...]}.
    If you include URLs, they must come from the supplied articles.
    Prefer [UK-relevant] items when the stories are otherwise similarly important.

The phrase “choose the most meaningful supplied stories” is included for FinTech synthesis and future-proofing. For High Tech, Telecoms, and company-specific summaries, the context selector will already have bounded the input.

### 7.3 Proposed FinTech system prompt

Use the same beginner rules, with this category-specific opening and selection instruction:

    You are Niv, a concise UK-focused FinTech curator.
    Use ONLY the supplied top FinTech articles.
    Synthesize related articles into distinct themes where useful, but do not combine unrelated facts.

Keep the same output limit, URL validation, acronym guidance, and plain-English requirement.

### 7.4 Output length and AI budget

Keep max_completion_tokens: 400.

The prompt becomes longer by a small number of input tokens, and a few bullets may be slightly longer because they explain terms. The hard output cap remains 400 tokens, so expected usage remains close to current usage.

Do not increase the number of context articles or create a scoring request. The first run after the FinTech prompt version changes will intentionally miss the old FinTech cache and make one FinTech summary call; later runs can use the existing input fingerprint cache when the top ten and prompt version are unchanged.

## 8. Exact file changes

### 8.1 scripts/ingest.mjs

Make these changes:

1. Add exported constants:

       export const INSIGHTS_SCORING_VERSION = "insights-v2";
       export const GENERAL_SUMMARY_PROMPT_VERSION = "insights-v2";
       export const FINTECH_SUMMARY_PROMPT_VERSION = "fintech-insights-v2";

2. Add the category term dictionaries and impact, novelty, practical-value, routine-content, promotional, and low-signal term dictionaries near the current UK signal constants.

3. Keep normalizeTitle, but add a bounded text helper that combines the title, snippet, excerpt, and a capped amount of extracted text for scoring. Do not send additional text to AI solely because scoring now reads more fields.

4. Add helpers for:

   - boundary-safe phrase matching;
   - category topic fit;
   - impact;
   - practical value;
   - novelty;
   - routine and promotional penalties;
   - low-signal content;
   - distinct-source counting;
   - the new bounded recency and authority values.

5. Replace the body of scoreItem with the new component-based score. The function should return or make available a score breakdown containing:

       topicFit
       impact
       practicalValue
       novelty
       recency
       authority
       ukRelevance
       crossSource
       penalties
       scoringVersion

6. Replace annotateHotness so that:

   - it computes normalised-title groups;
   - it passes both group size and distinct source count to scoreItem;
   - it keeps the existing groupSize field;
   - it adds scoreBreakdown and scoringVersion to each item;
   - it keeps the uk tag;
   - it keeps the format tag only for diagnostics, without giving it a score boost;
   - it sorts by score descending, then publication date descending, then URL ascending for deterministic ties.

7. Add and use selectSummaryContext for High Tech and Telecoms. Keep the existing FinTech selector and company-specific top-five behaviour.

8. Update generateWeeklyBullets to use the selected context. Keep:

   - High Tech maximum context of five;
   - Telecoms maximum context of five;
   - company-specific maximum context of five;
   - FinTech maximum context of ten;
   - maximum five output bullets;
   - one request per group;
   - model gpt-4o-mini;
   - max_completion_tokens: 400;
   - deterministic fallback behaviour;
   - URL allowlisting and bullet deduplication.

9. Replace the existing general and FinTech system prompt strings with the beginner-friendly versions in this plan.

10. Add scoringVersion, promptVersion, and contextUrls to every summary result. Ensure fallback and cache-hit results include the same metadata.

11. Update the FinTech cache hash to use FINTECH_SUMMARY_PROMPT_VERSION and the new scoring version. A ranking change should invalidate the FinTech summary when the selected top ten changes. The cache must still include URL, title, publication date, and bounded article context.

12. Keep ingestion diagnostics and add:

       scoringVersion
       summaryContextCounts

    The existing aiSummaryCalls, fintechAiSummaryCalls, and fintechSummaryCacheHits fields must remain.

13. Ensure no scoring helper imports or invokes the OpenAI client. Only generateWeeklyBullets may increment aiSummaryCalls.

### 8.2 scripts/check-data.mjs

Extend validation to:

- Require every article score to be finite.
- Require every article to have scoringVersion: "insights-v2".
- Validate that each score breakdown field is numeric and within its documented bounds.
- Validate that each dataset is sorted by descending score, with date and URL tie-breakers.
- Continue checking article URLs, source names, duplicate URLs, and source allowlists.
- Continue rejecting FinTech URLs from news.google.com, gov.uk, and *.gov.uk.
- Validate contextUrls for every summary:
  - it must be an array;
  - it must contain no more than five URLs for High Tech, Telecoms, and company summaries;
  - it must contain no more than ten URLs for FinTech;
  - every URL must occur in the corresponding dataset;
  - no context URL may be duplicated.
- Validate every summary scoringVersion.
- Validate the expected prompt version for each summary.
- Continue enforcing a maximum of five summary bullets.
- Check that each summary bullet URL, when present, belongs to its recorded context URLs.

The validator should report the dataset name and article index for every failure.

### 8.3 scripts/test-insights.mjs

Create a deterministic unit-style test script using node:assert/strict. Import the scoring and selection helpers from scripts/ingest.mjs.

Use fixed publication timestamps and a fixed now value so the tests do not depend on the current clock.

Required cases:

1. A material network rollout outranks a fresh generic partnership announcement.
2. A regulatory change outranks a routine company appointment.
3. A concrete product launch outranks a vague “exciting innovation” article.
4. An analysis title receives no automatic +0.5 boost.
5. A feature title receives no automatic +0.5 boost.
6. Two copies from the same source receive no cross-source corroboration.
7. The same normalised story from two different sources receives a limited corroboration score.
8. A fresh story with weak category terms does not outrank a slightly older story with strong category fit and impact solely because of freshness.
9. UK relevance helps a tie but does not override a materially more important global story.
10. Low-signal job, event, webinar, podcast, and career fixtures receive the expected penalty.
11. Company-specific content receives a relevance baseline even without generic High Tech or Telecoms keywords.
12. Scores are deterministic and have the documented component bounds.
13. Ranking tie-breaks are deterministic using score, publication date, and URL.
14. High Tech and Telecoms summary context is capped at five, avoids duplicate normalised titles where alternatives exist, and limits a dominant source to two where alternatives exist.
15. Company summary context remains capped at five without applying the multi-source cap.
16. FinTech summary context remains capped at ten and at three items per source.
17. A prompt or scoring version change changes the FinTech input hash.

### 8.4 scripts/test-fintech.mjs

Update the existing FinTech helper tests to:

- Expect FINTECH_SUMMARY_PROMPT_VERSION to be fintech-insights-v2.
- Verify the six approved FinTech sources remain unchanged.
- Verify the FinTech context and output limits remain 10 and 5.
- Verify score metadata is present on filtered/ranked FinTech fixtures.
- Verify the new penalty and topic signals do not remove valid FinTech items.
- Verify the cache hash is stable for identical ranked context and changes when title, date, excerpt, scoring version, or prompt version changes.

### 8.5 package.json

Add:

    "test:insights": "node scripts/test-insights.mjs"

Keep all existing scripts unchanged.

### 8.6 README.md

Update the documentation to explain:

- Scores are deterministic editorial heuristics, not reader popularity or AI judgements.
- Ranking now considers category fit, impact, practical value, novelty, recency, UK relevance, authority, corroboration, and penalties.
- Analysis and feature labels no longer receive an automatic ranking bonus.
- AI receives only the bounded selected context and is used to explain stories, not to score every article.
- The normal full run remains at most six summary calls: High Tech, Telecoms, FinTech, Accenture, Capco, and Sage.
- FinTech remains at most one summary call and uses its existing cache.
- The LinkedIn page continues to reuse saved summaries without an AI call.
- npm run test:insights is part of the local verification workflow.

### 8.7 Generated files under public/data

Do not hand-edit generated article or summary JSON.

After the code changes pass local tests, regenerate:

- public/data/hightech.json
- public/data/telecoms.json
- public/data/fintech.json
- public/data/company/accenture.json
- public/data/company/capco.json
- public/data/company/sage.json
- the matching files under public/data/summaries

The refreshed data should contain the new score breakdowns and summary metadata. The existing Microsoft removal checks must continue to pass.

## 9. AI usage and cost safeguards

The expected AI usage remains:

| Group | Context maximum | Output maximum | Requests per full run |
| --- | ---: | ---: | ---: |
| High Tech | 5 | 5 bullets | 1 |
| Telecoms | 5 | 5 bullets | 1 |
| FinTech | 10 | 5 bullets | 0 or 1 because of cache |
| Accenture | 5 | 5 bullets | 1 |
| Capco | 5 | 5 bullets | 1 |
| Sage | 5 | 5 bullets | 1 |
| **Maximum** | — | — | **6** |

The implementation must not:

- call OpenAI from scoreItem, annotateHotness, selectSummaryContext, or page rendering;
- call OpenAI once for each article;
- call OpenAI once for each feed;
- send more than ten FinTech articles;
- send more than five general/company articles;
- raise max_completion_tokens above 400 without a separate decision;
- add an AI call to the LinkedIn route or page;
- retry a failed summary request in the same ingestion run.

The prompt becomes more explicit and may add a small input-token amount. The output ceiling remains 400 tokens, so the expected cost should stay approximately the same. A prompt-version change causes one intentional FinTech cache miss after deployment; this is a one-time request, not a permanent increase.

## 10. Verification plan

Run checks in this order:

1. npm ci --no-audit --no-fund
2. node --check scripts/ingest.mjs
3. node --check scripts/check-data.mjs
4. node --check scripts/test-insights.mjs
5. npm run test:insights
6. npm run test:fintech
7. npm run check:sources
8. npm run check:data
9. OPENAI_API_KEY="" TEST_MODE=1 DRY_RUN=1 node scripts/ingest.mjs
10. npm run build

The dry-run must prove that:

- all groups can be collected and ranked;
- no OpenAI call is attempted without a key;
- fallback summaries remain within the five-bullet limit;
- FinTech remains within its ten-article context limit;
- diagnostics show zero AI calls in the no-key dry run;
- no generated files are modified by the dry run.

If an OpenAI key is available in the approved environment, run one controlled non-dry ingestion and record:

- aiSummaryCalls;
- fintechAiSummaryCalls;
- fintechSummaryCacheHits;
- context count per group;
- extraction failures;
- generated bullet counts.

The expected full-run call count is six or fewer, and the expected FinTech call count is zero or one.

## 11. Manual content review

After regeneration, inspect the first ten ranked items in:

- High Tech;
- Telecoms;
- FinTech;
- Accenture;
- Capco;
- Sage.

For each group, check:

- the top stories have a clear change or consequence;
- routine announcements are no longer overrepresented;
- analysis and feature stories are not automatically at the top;
- no single source dominates when alternatives exist;
- UK relevance is visible but not excessive;
- headlines and article URLs remain valid.

Inspect each saved summary and confirm:

- no more than five bullets;
- every bullet is grounded in one or more context URLs;
- acronyms are explained where necessary;
- the sentence says what happened and why it matters;
- there is no invented number or unsupported claim;
- fallback output still works if the OpenAI key is unavailable.

Inspect /linkedinPost and confirm:

- it still uses the first three saved bullets per category;
- it remains plain text with line breaks, bullets, and emojis;
- no Markdown markers, backticks, or raw JSON appear in the copy;
- no extra AI request occurs when the page is opened.

## 12. Deployment plan

Deployment should happen only after the implementation and generated-data review pass.

1. Review git diff and confirm only the intended scoring, prompt, test, documentation, and generated-data files changed.
2. Run the full verification sequence.
3. Commit with:

       feat: improve article ranking and beginner insights

4. Push to main.
5. Allow the existing GitHub Actions workflow to run.
6. Confirm the generated-data validation step passes.
7. Confirm the workflow commits refreshed JSON only when data changes.
8. Allow the resulting main update to trigger the existing Vercel deployment.
9. Verify production:

   - /
   - /data/hightech.json
   - /data/telecoms.json
   - /data/fintech.json
   - /api/weekly-summary?tab=hightech
   - /api/weekly-summary?tab=telecoms
   - /api/weekly-summary?tab=fintech
   - /linkedinPost

10. Confirm production summaries contain no more than five bullets and the LinkedIn page contains three per category.
11. Record the final GitHub Actions run and Vercel deployment result.

No new environment variables, Supabase changes, or Vercel settings are required.

## 13. Rollback plan

If the new ranking produces worse editorial results:

- first adjust deterministic weights or term lists in scripts/ingest.mjs;
- rerun npm run test:insights, ingestion, and npm run check:data;
- regenerate the data;
- redeploy the corrected commit.

If the prompt produces poor summaries:

- revise only the prompt wording;
- bump the relevant prompt version so the FinTech cache cannot reuse an old summary;
- keep the same context limits and 400-token completion cap.

Do not roll back by manually editing generated JSON. The source code and ingestion run must remain the source of truth.

## 14. Acceptance criteria

The implementation is complete when all of the following are true:

- improvements/better_insights.md is reflected in the code.
- Ranking uses bounded topic, impact, practical-value, novelty, recency, authority, UK, corroboration, and penalty components.
- The analysis/feature automatic boost is removed.
- Routine and low-signal items are down-ranked.
- Ranking is deterministic and validated.
- General summary context is at most five articles.
- FinTech summary context is at most ten articles and no more than three per source where alternatives exist.
- Every summary remains at most five bullets.
- The beginner-friendly prompt is active for general and FinTech summaries.
- AI calls remain at most six per full ingestion run.
- No AI call occurs on page view or LinkedIn page view.
- The OpenAI key is optional because deterministic fallback summaries still work.
- All focused tests, source checks, data checks, dry-run checks, and production build checks pass.
- Production pages and JSON endpoints return HTTP 200.
- The GitHub Actions workflow and automatic Vercel deployment complete successfully.

## 15. Open review question before implementation

The plan uses “biggest real-world change and practical relevance for UK readers” as the default meaning of interesting. If that remains the right editorial definition, implementation can proceed exactly as written. If the desired emphasis is instead surprising innovation, consumer usefulness, or investment/market impact, adjust the signal weights and term lists before coding.
