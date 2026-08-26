# FinTech Addition: Implementation Plan

**Status:** Implemented and tested
**Prepared:** 26 August 2026
**Repository:** NivsNewsRoom
**Scope:** Add a new FinTech category to the site, use an approved set of FinTech sources, generate a FinTech summary from the top 10 ranked FinTech articles, and add three FinTech bullets to the copy-ready LinkedIn post.

The source choices have now been reviewed and approved; implementation, generated-data refresh, commit, and deployment may proceed against this plan.

## 1. Intended outcome

The site will have a new top-level `FinTech` section alongside `High Tech` and `Telecoms`.

The new section should:

- Have its own navigation button.
- Display a full ranked FinTech article list at `/data/fintech.json`.
- Display a maximum of five FinTech key insights in the main site summary.
- Generate those insights from the top 10 ranked FinTech articles, as specifically requested for this category.
- Send only those top 10 articles to AI, with a per-article context cap; never make one AI request per article or per source.
- Make at most one FinTech summary AI request per ingestion run, with a reuse/cache path when the top-10 input has not changed.
- Use original publisher URLs rather than Google News or tracking URLs.
- Preserve the existing UK-relevance weighting and bounded article extraction.
- Add exactly three FinTech insight bullets to `/linkedinPost`.
- Keep the LinkedIn page plain-text friendly: normal text, line breaks, simple bullets, and occasional emojis only.
- Avoid GOV.UK sources. This plan does not add or reintroduce any GOV.UK feed.

The existing High Tech and Telecoms behaviour remains unchanged apart from adding the new category to the shared data and summary validation flow.

## 2. Decisions needed before implementation

The source set below has been approved for implementation.

### 2.1 Proposed UK-majority source approval

The revised recommendation is six feeds: four UK-focused or UK-facing sources and two major global sources. This gives the category a clear UK identity without making it dependent on one publisher.

UK-focused or UK-facing sources:

- [x] Finextra Payments RSS — approved
- [x] The FinTech Times RSS — approved
- [x] Open Banking Limited RSS — approved
- [x] FCA News RSS, with strict FinTech filtering — approved

Major global sources:

- [x] Payments Dive RSS — approved
- [x] PYMNTS RSS — approved

These are the approved sources for implementation. Open Banking Limited is a UK ecosystem body, and the FCA is a regulator rather than an independent newsroom; both must be visibly labelled and filtered.

Bank of England is kept as a reserve source rather than included in the first version because its general news feed is broad and would add institutional material without improving the AI input budget.

GOV.UK remains explicitly excluded.

### 2.2 LinkedIn generation decision

Recommended approach: do not make a separate AI request when the LinkedIn page is opened.

The daily ingest would:

1. Rank the FinTech dataset.
2. Give the AI the top 10 ranked FinTech articles.
3. Store up to five FinTech summary bullets in `public/data/summaries/fintech.json`.
4. Let the LinkedIn page reuse the first three of those stored FinTech bullets.

This keeps the LinkedIn page fast and predictable and avoids a second AI charge. It means the three LinkedIn bullets are derived from an AI summary whose source context is the top 10 FinTech articles.

If the desired behaviour is instead three bullets synthesising all 10 articles directly, that would require a separate LinkedIn-specific AI generation step and additional API usage. That is not included in this first plan unless explicitly requested.

### 2.3 FinTech AI cost guard

The important limit is the number and size of items sent to the OpenAI API, not the number of RSS feeds collected. The implementation must enforce all of the following:

- One FinTech summary request maximum per ingestion run.
- A hard maximum of 10 ranked FinTech articles in that request.
- A hard maximum of 400 words of excerpt/context per article, plus title, source, and URL.
- A hard maximum of 400 completion tokens on the summary request.
- No AI request while rendering the homepage, FinTech tab, API response, or LinkedIn page.
- No AI request per article, per RSS feed, or per source.
- Maximum five stored FinTech summary bullets.
- The LinkedIn page reuses three stored bullets and never calls AI.
- If the ranked top-10 input fingerprint is unchanged, reuse the existing FinTech summary instead of making another request.
- If the AI call fails, use deterministic fallback bullets without retrying the same FinTech request in that run.

With the current site structure, the normal run would therefore have the existing five summary calls (High Tech, Telecoms, Accenture, Capco, Sage) plus at most one FinTech call: six summary calls total. This must be recorded in ingestion diagnostics so a future code change cannot silently introduce per-article calls.

The cache fingerprint should include the FinTech prompt version and the top 10 article URLs, titles, publication dates, and excerpts. It should be stored alongside the FinTech summary and invalidated when the top-10 context or prompt version changes.

### 2.4 Newsletter decision

The existing newsletter contains High Tech and Telecoms sections. This plan proposes adding FinTech to the website and LinkedIn page only.

- [ ] Add FinTech to the weekly email newsletter as well.
- [x] Keep FinTech out of the weekly email newsletter for this phase.

The newsletter should not change unless separately approved, because its current five-item structure and email copy have already been tested.

## 3. Current architecture to extend

The current source and ingestion flow is:

1. `scripts/news-sources.mjs` defines shared RSS/sitemap sources and source authority scores.
2. `scripts/ingest.mjs` fetches sources, filters the lookback window, extracts article text, ranks articles, writes JSON, and generates summaries.
3. `public/data/hightech.json` and `public/data/telecoms.json` contain ranked article datasets.
4. `public/data/summaries/hightech.json` and `public/data/summaries/telecoms.json` contain maximum-five summary bullets.
5. `app/page.tsx` loads a category dataset and its summary based on the selected tab.
6. `app/api/weekly-summary/route.ts` exposes category summaries.
7. `scripts/check-data.mjs` validates generated files and summary limits.
8. `scripts/check-sources.mjs` validates configured feeds and sitemaps without writing data.
9. `app/linkedinPost/page.tsx` reads stored High Tech and Telecoms summaries and formats a copy-ready plain-text post.

FinTech should use the same path, with two deliberate exceptions:

- The AI context input limit will be 10 ranked FinTech articles rather than five, with no more than 400 words of extracted context per article.
- FinTech source collection may use several feeds, but the OpenAI request count remains one maximum per ingestion run.
- The LinkedIn post will include three FinTech bullets rather than the existing category limits used elsewhere.

The stored FinTech website summary should still be capped at five bullets, and the FinTech API and website should still emit no more than five bullets.

## 4. Source research and recommendations

Source availability was checked on 26 August 2026. The checks below distinguish a source that has a usable feed from a source that is editorially suitable for the category.

### 4.1 Recommended UK-focused and UK-facing sources

| Source | Feed URL | Test result | Strength | Risk or filtering need | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Finextra Payments | `https://www.finextra.com/rss/channel.aspx?channel=payments` | HTTP 200, XML, 54 parsed entries | Strong specialist fintech and payments coverage; the publisher documents channel-specific feeds | Global rather than UK-only; includes company announcements as well as reporting | Recommended UK/European specialist source |
| The FinTech Times | `https://thefintechtimes.com/feed/` | HTTP 200, RSS, 10 parsed entries | UK-based publication dedicated to financial technology; useful coverage across payments, banking, digital assets, RegTech, and FinTech ecosystems | Includes thought leadership, partnerships, and sponsored or first-party material; label source and retain editorial filtering | Recommended UK source |
| Open Banking Limited | `https://www.openbanking.org.uk/feed/` | HTTP 200, RSS, 30 parsed entries | Direct UK open-banking adoption, payments, fraud, lending, and smart-data updates | Ecosystem-body content can be promotional or self-referential; label it and do not allow it to dominate ranking | Recommended UK first-party source |
| Financial Conduct Authority | `https://www.fca.org.uk/news/rss.xml` | HTTP 200, RSS, 20 parsed entries | UK regulation, consumer protection, crypto, financial crime, innovation, and enforcement | Broad feed includes unauthorised-firm warnings and unrelated financial-services notices; exclude warnings and require FinTech topic terms | Recommended UK regulatory signal, subject to approval |

Finextra’s own RSS documentation lists separate feeds for payments, banking-adjacent topics, risk and regulation, security, startups, AI, and other channels. The first implementation should use the Payments channel only to keep the FinTech category focused and avoid duplicating too much High Tech coverage.

### 4.2 Recommended major global sources

| Source | Feed URL | Test result | Strength | Risk or filtering need | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Payments Dive | `https://www.paymentsdive.com/feeds/news/` | HTTP 200, RSS, 10 parsed entries | Professional payments journalism and analysis with strong coverage of payment infrastructure, fraud, wallets, cards, and regulation | More US-focused than UK-focused; use for global breadth and apply UK ranking rather than excluding it | Recommended global source |
| PYMNTS | `https://www.pymnts.com/feed/` | HTTP 200, RSS, 10 parsed entries | High-volume coverage across payments, commerce, embedded finance, AI, banking, and digital wallets | High volume and some sponsored or announcement material; use title/topic filters and source authority weighting | Recommended global source |

The global sources are intentionally limited to two major publishers. They add breadth to the UK-led mix without turning the category into a large, expensive content pipeline.

### 4.3 Reserve sources and sources not recommended for the first pass

| Source | Candidate URL or page | Finding | Decision |
| --- | --- | --- | --- |
| FinTech Futures | `https://www.fintechfutures.com/feed/` | The endpoint returned HTTP 403 in a direct request and the response could not be parsed as valid RSS by the current parser | Do not add until a stable, permitted feed or sitemap is verified |
| Bank of England News | `https://www.bankofengland.co.uk/rss/news` | HTTP 200, XML, 50 parsed entries, but the feed is broad and includes macroeconomic, statistical, and market material | Keep in reserve; add only with strict FinTech filtering if the UK regulatory mix later needs more institutional depth |
| Payment Systems Regulator | `https://www.psr.org.uk/news-and-updates/` | The news page is useful, but the attempted feed endpoint was not a usable RSS source | Defer a dedicated HTML/page adapter to a later phase |
| UK Finance | `https://www.ukfinance.org.uk/` | Relevant UK industry body, but no stable feed was selected in this first source pass | Investigate separately if more UK banking coverage is needed |
| Generic Google News queries | Google News RSS search URLs | Results use aggregator links that may not resolve to original publisher URLs consistently | Keep as a last-resort fallback only where original links can be recovered; never publish Google News URLs |

The first implementation should use the six-source UK-majority set above only after source approval. Do not add Bank of England, Payment Systems Regulator, UK Finance, or FinTech Futures in the first pass.

## 5. Proposed FinTech editorial model

### 5.1 Topics to include

The FinTech category should cover technology-driven financial services rather than all financial news.

Positive topic terms should include:

- fintech and financial technology
- payments and payment infrastructure
- digital wallets and mobile payments
- open banking and open finance
- embedded finance and banking-as-a-service
- real-time payments and account-to-account payments
- neobanks, challenger banks, and digital banking
- lending technology and buy now, pay later
- cards, acquiring, merchant services, and payment orchestration
- fraud prevention, identity, authentication, and financial crime technology
- regtech and compliance technology
- wealthtech, insurtech, and capital-markets technology
- stablecoins, tokenisation, digital assets, and central-bank digital money
- artificial intelligence used in banking or payments

### 5.2 Topics to exclude or down-rank

The filter should reject or down-rank items that are not useful FinTech news:

- general stock-market or macroeconomic reporting with no technology angle
- ordinary bank-rate, inflation, or economic-statistics stories
- careers, job listings, events, webinars, and podcasts without substantive news
- generic corporate results without a material technology or payments development
- duplicate press-release announcements appearing across multiple sources
- casino, gambling, betting, or consumer-finance content without a technology relevance
- navigation, category, tag, and archive pages
- unauthorised-firm warning lists when they come from the FCA feed

The filter should be conservative. An item should not be discarded solely because it is a company announcement if it contains a material product, infrastructure, partnership, acquisition, regulatory, or adoption development.

### 5.3 Source diversity and ranking

The category should not be dominated by one high-volume publisher.

Implement the following controls:

- Deduplicate by canonical article URL before ranking.
- Remove RSS tracking parameters such as `utm_source` when constructing the canonical URL, while retaining the original publisher path.
- Keep the source hostname visible in each article record.
- Keep the existing publication-date lookback and article extraction timeout.
- Keep UK signals and add FinTech-specific UK terms such as `UK`, `United Kingdom`, `open banking`, `FCA`, `PSR`, `Pay.UK`, `Faster Payments`, `CHAPS`, `London`, and `British`.
- Add source authority scores for approved sources rather than allowing feed volume to determine authority.
- Cap feed candidates at 12 recent items per source before enrichment, so the six-source first pass has a maximum of 72 pre-deduplication candidates.
- Cap the number of articles contributed by a single source to the AI context at three where enough cross-source material exists, while retaining the full ranked dataset for readers.
- Prefer a balanced top 10 containing several UK and global sources when possible.
- Treat source count and AI context count separately: collecting six feeds must never expand the AI context beyond 10 articles.

The top 10 input should be the final ranked list after filtering, deduplication, extraction, and UK weighting. It should not simply be the first 10 RSS entries from one source.

## 6. Exact implementation changes after source approval

### 6.1 `scripts/news-sources.mjs`

Add a new `fintech` entry to `FEED_SOURCES` using only the approved sources. The initial UK-majority shape is:

    fintech: [
      rss(
        "https://www.finextra.com/rss/channel.aspx?channel=payments",
        "Finextra Payments",
        ["finextra.com", "www.finextra.com"]
      ),
      rss(
        "https://thefintechtimes.com/feed/",
        "The FinTech Times",
        ["thefintechtimes.com", "www.thefintechtimes.com"]
      ),
      rss(
        "https://www.openbanking.org.uk/feed/",
        "Open Banking Limited",
        ["openbanking.org.uk", "www.openbanking.org.uk"]
      ),
      rss(
        "https://www.fca.org.uk/news/rss.xml",
        "Financial Conduct Authority",
        ["fca.org.uk", "www.fca.org.uk"],
        undefined,
        {
          includeTerms: ["fintech", "payments", "open banking", "crypto", "digital assets", "financial crime", "innovation", "regtech"],
          excludeTerms: ["unauthorised firm", "unauthorized firm", "warning list"]
        }
      ),
      rss(
        "https://www.paymentsdive.com/feeds/news/",
        "Payments Dive",
        ["paymentsdive.com", "www.paymentsdive.com"]
      ),
      rss(
        "https://www.pymnts.com/feed/",
        "PYMNTS",
        ["pymnts.com", "www.pymnts.com"]
      ),
    ],

The `rss` helper will need to accept optional filtering metadata (for example `includeTerms` and `excludeTerms`) so the FCA feed is not ingested as general financial-services news. A suitable shape is `rss(url, label, allowedHosts, fallback, options = {})`; the important requirement is that filtering happens before ranking.

For the approved FCA source, exclude warning lists, enforcement-only items, general securities/IPO announcements, administration notices, and international attaché announcements unless a future editorial decision explicitly broadens the category. This keeps the regulator feed focused on innovation, payments, open banking, financial crime, APIs, and FinTech support.

Add explicit authority scores for approved FinTech hosts, for example:

    "finextra.com": 0.30,
    "thefintechtimes.com": 0.28,
    "paymentsdive.com": 0.28,
    "pymnts.com": 0.24,
    "openbanking.org.uk": 0.35,
    "fca.org.uk": 0.38,

The final authority table must contain only sources that are actually approved and active. Do not add GOV.UK or a `gov.uk` authority entry.

The flattened `SOURCE_REGISTRY` should include FinTech automatically through the existing `FEED_SOURCES` flattening logic.

### 6.2 `scripts/ingest.mjs`

Add FinTech-specific filtering and ranking context.

Add constants near the existing UK signal lists:

    const FINTECH_CONTEXT_LIMIT = 10;
    const FINTECH_SUMMARY_OUTPUT_LIMIT = 5;
    const FINTECH_LINKEDIN_LIMIT = 3;
    const FINTECH_MAX_ITEMS_PER_SOURCE = 12;
    const FINTECH_WORDS_PER_ITEM_CAP = 400;
    const FINTECH_SUMMARY_PROMPT_VERSION = "fintech-v1";
    const FINTECH_INCLUDE_TERMS = [
      "fintech", "payments", "payment", "digital wallet", "open banking",
      "open finance", "embedded finance", "neobank", "real-time payments",
      "instant payments", "banking as a service", "regtech", "wealthtech",
      "insurtech", "lending", "buy now pay later", "bnpl", "stablecoin",
      "tokenisation", "tokenization", "digital assets", "fraud prevention",
      "financial crime", "identity verification", "payment infrastructure",
      "merchant services", "acquiring", "payment orchestration"
    ];

Implement a `filterFintechItems` helper that checks the title, snippet, and excerpt. Use source-specific filters where a feed is already category-specific, so a Finextra Payments item does not need to contain the literal word `fintech`.

The filtering flow should be:

1. Fetch each approved source and keep no more than the 12 most recent in-window candidates per source.
2. Apply the source allowlist.
3. Apply the lookback window.
4. Enrich articles with extracted title/date/text.
5. Apply FinTech topic filtering to broad sources.
6. Canonicalise and deduplicate URLs.
7. Apply UK/FinTech scoring and source authority.
8. Write the full ranked dataset.
9. Select the first 10 ranked FinTech items as the only AI context.
10. Generate the summary once, or reuse the cached summary when its input fingerprint is unchanged.

Update `processGroupWeekly` or add a FinTech-specific wrapper so that:

    results.push(await processGroupWeekly("fintech", FEED_SOURCES.fintech));

writes:

    public/data/fintech.json
    public/data/summaries/fintech.json

The generic group processor may remain shared, but FinTech filtering must happen before the final ranking and summary selection. The per-source candidate cap is a collection/processing safeguard; it must not be confused with the separate hard AI context cap of 10.

Support a one-off `INGEST_GROUP=fintech` mode for targeted FinTech refreshes and testing. The scheduled workflow continues to run all groups when this variable is absent.

### 6.3 Ten-article FinTech AI context

Keep the existing global `SUMMARY_LIMIT = 5` as the maximum output limit. Add separate FinTech input/output limits:

    const summaryInputLimit = tabName === "fintech"
      ? FINTECH_CONTEXT_LIMIT
      : SUMMARY_LIMIT;
    const summaryItems = items.slice(0, summaryInputLimit);

For FinTech context construction, pass no more than `FINTECH_WORDS_PER_ITEM_CAP` words from each article. The request must contain at most 10 article blocks, regardless of how many approved feeds were configured.

For FinTech, the AI prompt should say:

    Use the supplied top 10 FinTech articles as the only source context.
    Synthesize related stories into concise themes.
    Return no more than five bullets.
    Do not invent facts or URLs.

For High Tech, Telecoms, and company summaries, preserve the current top-five input behaviour.

The summary output safety rules remain the same for every category:

- Keep no more than five bullets.
- Remove empty model bullets.
- Remove duplicate URLs.
- Accept only URLs from the supplied FinTech top 10 for FinTech bullets.
- Top up missing output with deterministic fallback bullets from the permitted input items.
- Return the final result sliced to `FINTECH_SUMMARY_OUTPUT_LIMIT` (five).

Before calling OpenAI for FinTech, calculate a stable SHA-256 fingerprint from `FINTECH_SUMMARY_PROMPT_VERSION` and each selected item’s URL, title, publication date, and bounded excerpt. Read the existing `public/data/summaries/fintech.json`; if its fingerprint matches, reuse its bullets and skip the API request. Store `inputHash` and `promptVersion` in the generated summary metadata.

If fewer than 10 FinTech articles survive filtering, pass all available articles and record the available count in diagnostics. Do not fabricate items to reach 10.

If `OPENAI_API_KEY` is unavailable or the call fails, use deterministic fallback summaries from the ranked FinTech input and still cap output at five. Do not issue a second FinTech request as a recovery attempt.

### 6.4 `app/page.tsx`

Add FinTech to the tab type and button list.

The proposed tab order is:

    const TABS = ["Company Specific", "High Tech", "FinTech", "Telecoms"] as const;

Add the data path:

    if (tab === "FinTech") return "/data/fintech.json";

Add the summary path:

    if (tab === "FinTech") return "/api/weekly-summary?tab=fintech";

Add the heading:

    tab === "FinTech"
      ? "Key insights from FinTech this week"

Keep the existing main-site summary limit at five. FinTech is a new category, not a replacement for the existing summary rule.

Keep the full FinTech article list below the summary so users can read more than the five key insights.

### 6.5 `app/api/weekly-summary/route.ts`

Accept `tab=fintech` and map it to:

    public/data/summaries/fintech.json

The route should continue returning HTTP 400 for unknown tabs and should defensively slice every response to five bullets.

The supported category comment should become:

    // "hightech" | "fintech" | "telecoms" | "company"

### 6.6 `scripts/check-data.mjs`

Add the FinTech dataset and summary:

    ["fintech", "public/data/fintech.json", "public/data/summaries/fintech.json"],

Continue enforcing:

- Maximum five summary bullets.
- Valid absolute article URLs.
- No duplicate article URLs.
- Non-empty source values.
- Summary URLs present in the corresponding article dataset.
- Summary URLs limited to the ranked top 10 for FinTech and the ranked top five for other categories when they are linked bullets.
- Valid generated timestamps.
- Non-empty overall datasets.

Add FinTech-specific checks:

- All FinTech article URLs use one of the approved source hostnames.
- No FinTech article has a `news.google.com` URL.
- No FinTech article has a GOV.UK URL.
- At least one FinTech source contributes a usable article in the normal run.

The source-specific allowlist should be derived from the approved registry rather than hard-coded in several files where practical.

### 6.7 `scripts/check-sources.mjs`

The existing flattened registry should discover the new FinTech sources automatically. Extend output or grouping only if needed to make the logs clear:

    OK fintech | Finextra Payments | rss | ...
    OK fintech | The FinTech Times | rss | ...

The required-category rule should fail the source check only if all approved FinTech sources are unavailable or produce zero usable entries.

One blocked source must remain a warning if other FinTech sources are healthy.

For FCA, the health check should report both raw feed count and post-filter usable count so a broad feed cannot appear healthy only because it contains unrelated finance news. Apply the same diagnostic if Bank of England is added in a later phase.

### 6.8 `app/linkedinPost/page.tsx`

Read `fintech.json` in addition to the existing summaries:

    const [telecoms, highTech, fintech] = await Promise.all([
      readSummary("telecoms.json"),
      readSummary("hightech.json"),
      readSummary("fintech.json"),
    ]);

Use separate limits:

    const LINKEDIN_INSIGHT_LIMIT = 3;

Update the helper so it accepts a per-section limit, or add a FinTech-specific helper. The FinTech section must use only the first three stored FinTech summary bullets.

Update the post builder to include a third section, preferably after High Tech:

    💳 FinTech
    ⭐️ ...
    ⭐️ ...
    ⭐️ ...

The section should contain exactly three bullets when at least three FinTech summary bullets are available and fewer only when the source data genuinely contains fewer usable insights.

The final post structure should be:

1. Existing connectivity/innovation opening.
2. Existing site explanation.
3. `📞 Telecoms` and three existing Telecoms bullets.
4. `💻 High Tech` and three existing High Tech bullets.
5. `💳 FinTech` and three FinTech bullets.
6. Existing subscription call to action.
7. Existing engagement question.
8. Hashtags updated to include `#FinTech`.

Keep the LinkedIn output plain-text friendly:

- Use normal ASCII/standard Unicode letters, not mathematical bold characters.
- Do not output Markdown `**`, `__`, backticks, or link syntax.
- Keep line breaks and the existing `⭐️`/section emojis.
- Strip Markdown markers and normalise NFKC characters from stored summary text before copying.
- Do not append article URLs to the post body unless separately requested.

Keep the copy button copying exactly the post body and not the page’s explanatory note.

### 6.9 `README.md` and metadata

Document:

- FinTech as a new category.
- The approved sources and their roles.
- The distinction between the top 10 FinTech AI input and maximum-five website summary output.
- The three-bullet FinTech LinkedIn section.
- The source-health and data-validation commands.
- That GOV.UK is intentionally excluded.

Update the homepage metadata and any source/category descriptions only after the FinTech sources are approved.

The LinkedIn page metadata should mention FinTech after the page is updated.

## 7. Generated files and data migration

After source approval and code implementation, generate:

    public/data/fintech.json
    public/data/summaries/fintech.json

Regenerate existing category data only if the shared ingestion changes affect them. Do not manually edit generated JSON to make checks pass.

The FinTech dataset should retain the complete ranked article list for the current lookback window after the per-source candidate cap. The summary should contain no more than five bullets and should include the `inputHash` and `promptVersion` metadata used by the cache. The LinkedIn page should select three of those bullets at render/build time.

Before committing, inspect the generated FinTech data for:

- Original publisher URLs.
- No Google News URLs.
- No GOV.UK URLs.
- No duplicate URLs.
- No category/archive/navigation pages.
- A reasonable mix of approved sources.
- Fresh publication dates within the configured lookback window.

## 8. Testing plan

### 8.1 Static checks

Run:

    npm ci --no-audit --no-fund
    node --check scripts/news-sources.mjs
    node --check scripts/ingest.mjs
    node --check scripts/check-sources.mjs
    node --check scripts/check-data.mjs
    node --check scripts/preview-newsletter.mjs
    npm run check:data
    npm run check:sources
    npm run build

The Next build must include the FinTech route in the main page’s client bundle and compile the updated LinkedIn page.

### 8.2 Source and ingestion tests

Run a safe sample without writing generated files:

    OPENAI_API_KEY="" TEST_MODE=1 DRY_RUN=1 node scripts/ingest.mjs

Expected results:

- The process exits successfully when at least one required FinTech source produces usable entries.
- FinTech diagnostics appear under the `fintech` group.
- Failed individual sources do not abort the whole category when another source is healthy.
- The normal summary output is no more than five bullets.
- No generated files change.

Run a normal ingestion after the source set is approved:

    TEST_MODE=0 DRY_RUN=0 node scripts/ingest.mjs

If the normal run uses OpenAI, verify the existing five category/company summary calls remain within the intended billing budget, with FinTech adding at most one category call. The run must report an explicit summary-call count and FinTech must report `0` when its input fingerprint is reused.

The normal-run cost assertions are:

- FinTech OpenAI calls: `0` when cached or when no API key is present; otherwise exactly `1`.
- FinTech AI articles per call: no more than `10`.
- FinTech context words: no more than `400` per article, excluding the fixed title/source/URL fields.
- FinTech completion tokens: no more than `400`.
- LinkedIn/API/page-render OpenAI calls: `0`.
- Total current-run summary calls: no more than `6`.

### 8.3 FinTech-specific assertions

Add or run checks that prove:

- At least 10 FinTech articles are available when the approved sources provide enough content; otherwise the diagnostic states the actual count.
- The AI context-selection helper receives no more than the top 10 ranked FinTech items.
- A six-source feed configuration still produces no more than one FinTech AI request.
- A repeated run with the same top-10 fingerprint makes zero additional FinTech AI requests.
- The request payload contains no more than 400 bounded context words per article.
- The AI output is reduced to no more than five bullets.
- Every linked FinTech summary URL belongs to the permitted ranked top 10 items after final ranking.
- Every FinTech dataset URL belongs to an approved source hostname.
- No FinTech dataset URL contains `news.google.com` or `gov.uk`.
- The LinkedIn builder outputs no more than three FinTech bullets.
- The LinkedIn output contains no `**`, `__`, backticks, or mathematical-bold heading characters.

Recommended lightweight test fixtures:

1. A feed with 12 valid FinTech items: verify that only the top 10 enter the AI context.
2. A feed with 10 items and a model response containing 10 bullets: verify that only five are retained.
3. A model response with invalid URLs: verify that invalid URLs are removed and deterministic top-up is used.
4. A feed containing generic banking-rate and warning items: verify that FinTech filtering rejects or down-ranks them as designed.
5. A summary with five bullets: verify that the LinkedIn builder uses exactly three.

### 8.4 Local HTTP smoke tests

Start the production server after the build:

    npm run start -- -p 3100

Check:

    curl -i http://localhost:3100/
    curl -i http://localhost:3100/api/weekly-summary?tab=fintech
    curl -i http://localhost:3100/data/fintech.json
    curl -i http://localhost:3100/linkedinPost
    curl -i http://localhost:3100/sitemap.xml

Expected results:

- The main page responds with HTTP 200.
- The FinTech API responds with HTTP 200 and no more than five bullets.
- The FinTech dataset responds with HTTP 200.
- The LinkedIn page responds with HTTP 200.
- The LinkedIn response includes Telecoms, High Tech, and FinTech sections.
- The LinkedIn response includes three FinTech insight lines when three are available.
- The sitemap includes the existing site routes; no separate FinTech URL is required because FinTech is a tab on the homepage.

### 8.5 Browser QA

At desktop and mobile widths verify:

- A FinTech button appears alongside High Tech and Telecoms.
- The tab order is clear and the active state is visible.
- Clicking FinTech loads the article list and summary without a full-page error.
- The FinTech summary never displays more than five cards.
- The full FinTech article list remains available below the summary.
- Source labels and UK tags continue to display correctly.
- Article links open original publisher pages.
- The LinkedIn page shows three FinTech bullets, with normal text rather than bold Unicode characters.
- The Copy post button copies only the post text.
- The copied post contains readable line breaks on paste into LinkedIn.

## 9. Deployment sequence

Do not deploy until the source choices are approved.

After approval:

1. Add only the approved FinTech sources to `scripts/news-sources.mjs`.
2. Implement FinTech filters, ranking, the top-10 AI context exception, and five-bullet output guard.
3. Add the FinTech tab and API path.
4. Add FinTech to data validation and source diagnostics.
5. Add the three-bullet FinTech LinkedIn section.
6. Run the source health check.
7. Run the safe dry-run ingestion.
8. Run a normal ingestion and inspect `public/data/fintech.json`.
9. Run `npm run check:data` and `npm run build`.
10. Run local HTTP and LinkedIn plain-text checks.
11. Commit code and generated FinTech data together.
12. Push to `main`; Vercel will deploy automatically.
13. Verify the production FinTech API, homepage tab, dataset, and LinkedIn page.
14. Manually run the GitHub Actions ingestion workflow once with `test_mode=0` after deployment to prove the scheduled path uses the approved source registry.

Do not call the live weekly newsletter endpoint during testing because it sends email. Do not trigger a second AI request from the LinkedIn page.

## 10. Acceptance criteria

The implementation is complete when:

- The homepage has a FinTech button alongside High Tech and Telecoms.
- FinTech article data is stored in `public/data/fintech.json`.
- FinTech summary data is stored in `public/data/summaries/fintech.json`.
- The approved source registry contains no GOV.UK feed.
- FinTech articles use original approved publisher URLs.
- The FinTech dataset contains no Google News URLs or GOV.UK URLs.
- The FinTech summary is generated from up to the top 10 ranked FinTech articles.
- The FinTech summary and API never emit more than five bullets.
- The LinkedIn post contains three FinTech bullets when three usable summaries exist.
- The LinkedIn post contains no Markdown or Unicode-bold formatting.
- Existing High Tech, Telecoms, and company-specific sections continue to work.
- `npm run check:data` passes.
- `npm run check:sources` passes.
- `npm run build` passes.
- The deployed FinTech tab and API respond successfully.
- The deployed LinkedIn page contains the new FinTech section.
- A real GitHub Actions ingestion completes using the new registry.

## 11. Risks and mitigations

### Source overlap

Finextra, Payments Dive, PYMNTS, and The FinTech Times may cover the same large payment-company announcements. Canonical URL deduplication, title similarity checks, and source diversity scoring should prevent one story from becoming several top insights.

### Promotional content

FinTech publications and ecosystem bodies can carry sponsored or company-authored material. Keep source labels visible, down-rank obvious promotional items where possible, and retain a mix of independent and first-party sources.

### UK relevance

The strongest global sources will not always be UK-focused. Use the existing UK ranking signals and the proposed Open Banking Limited and filtered FCA feeds for UK-specific context. Keep Bank of England as a reserve until there is a clear editorial need.

### Official source scope

The FCA feed can add useful UK regulatory context but also broad institutional updates, so it requires source-specific topic filters and exclusion of warning-list noise. Bank of England remains a reserve source for the same reason. GOV.UK remains excluded.

### Ten-article AI input cost

FinTech will use more AI context than the other categories by design, but the cost is bounded: one request maximum per ingestion run, ten ranked items maximum, 400 words maximum per item, five bullets maximum, and no additional LinkedIn AI call unless separately approved.

### Sparse weeks

If fewer than 10 valid FinTech items are available, summarize the available items and show fewer LinkedIn bullets if fewer than three insights can be safely produced. Never invent filler stories.

### AI cost drift

Adding more sources must not increase the AI request count. Keep the per-run call counter, top-10 selector, 400-word context cap, prompt-version fingerprint, and cache assertions covered by tests. Any future request for a separate FinTech LinkedIn synthesis must be treated as a deliberate paid-feature decision, not an implementation detail.

### Feed instability

The source-health rule should be category-level. One blocked publisher must not stop FinTech ingestion when other approved sources are healthy. The diagnostics must make the failing source visible in the GitHub Actions log.

## 12. Research references

The following pages and direct feeds were used for the source review on 26 August 2026:

- [Finextra RSS feed directory](https://www.finextra.com/featurearticle/2406/our-rss-feeds)
- [Finextra Payments RSS feed](https://www.finextra.com/rss/channel.aspx?channel=payments)
- [The FinTech Times](https://thefintechtimes.com/)
- [The FinTech Times RSS feed](https://thefintechtimes.com/feed/)
- [Payments Dive](https://www.paymentsdive.com/)
- [Payments Dive RSS feed](https://www.paymentsdive.com/feeds/news/)
- [PYMNTS FinTech and payments coverage](https://www.pymnts.com/fintech-payments/)
- [PYMNTS RSS feed](https://www.pymnts.com/feed/)
- [Open Banking Limited latest updates](https://www.openbanking.org.uk/latest/)
- [Open Banking Limited RSS feed](https://www.openbanking.org.uk/feed/)
- [FCA News](https://www.fca.org.uk/news)
- [FCA RSS feed](https://www.fca.org.uk/news/rss.xml)
- [Bank of England FinTech research](https://www.bankofengland.co.uk/research/fintech)
- [Bank of England RSS feeds](https://www.bankofengland.co.uk/rss)
- [Payment Systems Regulator news and updates](https://www.psr.org.uk/news-and-updates/)

These references support the proposed shortlist. Source approval must come from the project owner before any of them are added to the live registry.
