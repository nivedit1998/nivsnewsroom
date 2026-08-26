# Nivs Newsroom Improvements: Top Five Insights and Company Coverage

**Status:** Planning only
**Prepared:** 26 August 2026
**Repository:** NivsNewsRoom
**Scope:** Reduce weekly insight generation to a maximum of five items per category, replace Microsoft with Accenture, add Capco, and improve the quality and resilience of news sources.

## 1. Intended outcome

The site should have three company-specific choices:

1. Accenture
2. Capco
3. Sage

Microsoft is removed from the user interface, API validation, ingestion, generated data, and documentation. Sage remains.

For every category and company:

- The full ranked article list remains available below the summary.
- Only the top five ranked articles are passed to the AI summariser.
- The generated summary contains no more than five insight bullets.
- The website displays no more than five insight bullets and no longer needs a “Show all” control.
- The newsletter and local newsletter preview also remain capped at five bullets.

The ingestion should favour first-party and authoritative sources, while retaining reputable independent publishers for broader context. Google News RSS remains a recovery fallback only, not a primary source.

## 2. Current implementation audit

### 2.1 Current data flow

The current flow is:

1. The GitHub Actions workflow runs the Node ingestion script.
2. The script reads RSS or Atom feeds in scripts/ingest.mjs.
3. Feed items are filtered by the seven-day lookback window and deduplicated by URL.
4. Each article URL is fetched with @extractus/article-extractor to obtain full text or an excerpt.
5. Articles are ranked using recency, source authority, UK signals, and duplicate/group signals.
6. The script writes the complete ranked arrays to public/data.
7. The script passes a large slice of each ranked array to OpenAI and writes summary JSON files.
8. The Next.js page fetches the article JSON and summary JSON/API response.
9. Vercel serves the committed JSON and the weekly newsletter route uses the same summary files.

### 2.2 Current primary sources

Current sources are defined inline in scripts/ingest.mjs.

| Area | Current sources | Current concern |
| --- | --- | --- |
| High Tech | CNET, TechCrunch, The Verge, 9to5Google, 9to5Mac | Good general coverage, but the 9to5 feeds dominate the stored data and can include adjacent network content such as 9to5Toys. |
| Telecoms | Telecoms Tech News twice, Total Telecom twice, RCR Wireless, Light Reading | Duplicate URLs are configured for Telecoms Tech News and Total Telecom. The Light Reading endpoint currently returns 404. |
| Microsoft | Six Microsoft first-party feeds plus Google News fallbacks | This entire company dataset will be removed. |
| Sage | Sage UK blog and Sage UK newsroom plus Google News fallbacks | Retain, but monitor the first-party feeds and keep the fallback controlled. |

The current repository snapshot also shows the concentration problem:

- High Tech data is heavily weighted toward 9to5Mac and 9to5Google.
- Telecoms has very low coverage and relies on a Google News fallback for part of the dataset.
- Microsoft and Sage are currently separate generated datasets.

The source list should therefore be treated as a registry with diagnostics, not as an unmonitored list of URLs.

## 3. Recommended source strategy

### 3.1 Company-specific sources

#### Accenture

Use the official Accenture Newsroom sitemap as the primary discovery source:

    https://newsroom.accenture.com/sitemap.xml

Filter sitemap entries to:

    https://newsroom.accenture.com/news/YYYY/...

This gives direct first-party releases and dates through sitemap lastmod values. The newsroom homepage and sitemap were reachable during the review. Guessed RSS endpoints at /rss, /feed, and /news/rss returned 404, so the implementation should not depend on an unverified RSS URL.

Recommended fallback:

    https://news.google.com/rss/search?q=site%3Anewsroom.accenture.com%2Fnews&hl=en-GB&gl=GB&ceid=GB%3Aen

The fallback must preserve the original Accenture URL from each Google News item and must mark the source as fallback in diagnostics.

Do not include every Accenture blog or investor-relations URL in the first version. The company tab should focus on company news, partnerships, acquisitions, product/technology announcements, and research releases. Add the official blog stream later only if the tab is too sparse.

#### Capco

Use the official Capco sitemap:

    https://www.capco.com/sitemap.xml

Include only article paths in these sections:

    /about-us/newsroom-and-media/
    /intelligence/capco-intelligence/

The newsroom section supplies company announcements, partnerships, awards, and leadership news. Capco Intelligence supplies technology, data, AI, financial-services, energy, and regulatory insight that is more useful for this audience than a generic company-only feed.

Recommended fallback:

    https://news.google.com/rss/search?q=site%3Acapco.com%2Fabout-us%2Fnewsroom-and-media+OR+site%3Acapco.com%2Fintelligence&hl=en-GB&gl=GB&ceid=GB%3Aen

Do not include the Capco careers, contact, service landing pages, or generic navigation pages discovered in the sitemap. A sitemap path allowlist is required.

#### Sage

Retain the existing first-party sources:

    https://www.sage.com/en-gb/blog/feed/
    https://www.sage.com/en-gb/newsroom/feed/

Keep the existing Google News fallbacks, but ensure that fallback results are accepted only when the resulting article URL belongs to sage.com.

### 3.2 Better High Tech and Telecoms sources

Keep the existing independent publishers for breadth, but add authoritative sources in a controlled way.

| Priority | Source | Feed/adapter | Reason |
| --- | --- | --- | --- |
| 1 | GSMA Newsroom | https://www.gsma.com/newsroom/feed/ | First-party mobile-industry announcements, reports, and connectivity developments. |
| 2 | Ofcom News Centre | https://www.ofcom.org.uk/news-centre | High-value UK telecoms and media regulation source; the page is live but does not currently expose a verified RSS endpoint, so use a dedicated page/sitemap adapter only after the first source pass. |
| 2 | Openreach News | https://www.openreach.com/news | Useful UK fibre rollout and network infrastructure source; add only after verifying a stable feed or sitemap. |
| 2 | BT Newsroom | https://www.bt.com/about/newsroom | Useful operator and network announcements; add only after verifying a stable feed or sitemap. |

The first implementation added GSMA. Ofcom, Openreach, and BT should be evaluated as a second phase rather than scraping several HTML pages immediately. Government feeds are intentionally excluded from the active registry.

### 3.3 Source-quality rules

Implement these rules while adding sources:

- Keep one canonical URL per publisher where duplicate endpoints produce the same content.
- Prefer article URLs on the publisher’s own domain over tracking or aggregator URLs.
- Use a source allowlist for company datasets.
- Store a source kind in diagnostics: primary RSS/Atom, primary sitemap, or fallback RSS.
- Do not treat a successful HTTP response with zero parseable articles as a healthy feed.
- Keep failed-source diagnostics visible in the GitHub Actions log.
- Avoid publishing navigation pages, category pages, careers pages, and duplicate press-release URLs.
- Keep the existing UK relevance weighting, but add explicit authority scores for GSMA, Accenture, Capco, Ofcom, Openreach, and BT.

## 4. Exact implementation changes

### 4.1 Add a shared Node source registry

Add a new file: scripts/news-sources.mjs.

Move the source definitions out of scripts/ingest.mjs so ingestion and source-health checks use exactly the same configuration.

Export:

- SUMMARY_LIMIT = 5
- FEED_SOURCES for High Tech and Telecoms
- COMPANY_SOURCES for Accenture, Capco, and Sage
- SOURCE_FALLBACKS
- SOURCE_AUTHORITY
- a flattened SOURCE_REGISTRY for diagnostics and tests

Use a source shape like:

    {
      kind: "rss",
      url: "https://www.gsma.com/newsroom/feed/",
      label: "GSMA Newsroom",
      allowedHosts: ["gsma.com", "www.gsma.com"]
    }

Use a sitemap shape like:

    {
      kind: "sitemap",
      url: "https://newsroom.accenture.com/sitemap.xml",
      label: "Accenture Newsroom",
      includePath: /^\/news\/\d{4}\//i,
      allowedHosts: ["newsroom.accenture.com"]
    }

The regular-expression value can remain in the .mjs registry. Do not move this configuration into JSON unless the implementation also adds a safe serialisation format for path filters.

### 4.2 Update scripts/ingest.mjs

Remove the inline SOURCES, COMPANY_RSS, and source fallback definitions and import them from scripts/news-sources.mjs.

Add a direct sitemap fetcher:

    async function parseSitemapWithRetry(url) {
      const xml = await fetchTextWithRetry(url);
      const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
      const rows = Array.isArray(parsed?.urlset?.url)
        ? parsed.urlset.url
        : parsed?.urlset?.url
          ? [parsed.urlset.url]
          : [];
      return rows
        .map((row) => ({
          url: String(row.loc || "").trim(),
          lastmod: String(row.lastmod || "").trim()
        }))
        .filter((row) => row.url);
    }

Use fast-xml-parser as a direct dependency in package.json; update package-lock.json through the normal npm install process. Do not rely on the transitive xml2js dependency that comes with rss-parser, because rss-parser rejects sitemap XML as a non-RSS document.

Add a sitemap source path:

    async function getSitemapItems(source) {
      const rows = await parseSitemapWithRetry(source.url);
      const candidates = rows
        .filter((row) => source.includePath.test(new URL(row.url).pathname))
        .filter((row) => source.allowedHosts.includes(new URL(row.url).hostname))
        .filter((row) => withinWindow(toISOorNull(row.lastmod)))
        .slice(0, TEST_MODE ? 2 : 30);

      return candidates.map((row) => ({
        title: "",
        url: row.url,
        publishedAt: toISOorNull(row.lastmod),
        source: new URL(row.url).hostname.replace(/^www\./, ""),
        snippet: ""
      }));
    }

Do not use the sitemap’s lastmod as the final publication date when the article page exposes a more precise date. Treat it as the initial date and let article extraction replace it when a valid published date is available.

Add a source dispatcher:

    async function getSourceItems(source) {
      if (source.kind === "sitemap") return getSitemapItems(source);
      return getFeedItems(source.url);
    }

Update processCompanyWeekly to iterate over COMPANY_SOURCES[company], call getSourceItems, and apply source-specific fallbacks when a primary source fails or returns zero usable articles.

Improve addFullText for sitemap records:

- Use the extracted page title when the incoming title is empty.
- Use the extracted published date when it parses successfully.
- Use the extracted description as a snippet when no feed summary exists.
- Drop the record if it has no valid title after extraction and no safe fallback title.
- Keep the existing full-text/excerpt behaviour.
- Add an article extraction timeout so a blocked company page cannot stall the whole workflow.

Add a bounded article concurrency helper. A concurrency of four is sufficient for the first implementation. Keep the existing retry/timeout behaviour for feeds and apply a 15–20 second timeout to article extraction.

### 4.3 Limit AI context and output to five

In scripts/ingest.mjs, replace the current large summary context limits:

- Remove CONTEXT_ITEM_LIMIT = 60.
- Remove the 10,000-word summary budget as the primary selection mechanism.
- Add SUMMARY_LIMIT = 5 from scripts/news-sources.mjs.
- Define const summaryItems = items.slice(0, SUMMARY_LIMIT).
- Build the model context from summaryItems only.
- Keep a per-item text cap, but reduce it to a practical value such as 500–600 words.

Change the prompt so it explicitly requests one bullet per supplied item and no more than five bullets:

    Return strict JSON only:
    {"bullets":[{"text":"...","urls":["..."]}]}
    Create at most five bullets, one for each supplied item.
    Do not add facts or URLs that are not present in the supplied items.

Change all fallback generation from items.slice(0, 10) to summaryItems or items.slice(0, SUMMARY_LIMIT).

After parsing the model response:

- Keep at most five model bullets.
- Accept only URLs from the five supplied items.
- Remove duplicate URLs.
- Remove empty bullet text.
- Top up missing bullets from the five supplied ranked items using the deterministic fallback.
- Return the final array sliced to five.

This gives a deterministic maximum even if the model ignores the requested limit or returns malformed partial JSON.

### 4.4 Replace Microsoft and add Capco in app/page.tsx

Update the company type:

    type Company = "accenture" | "capco" | "sage";

Replace the current Microsoft/Sage state with:

    const [company, setCompany] = useState<Company>("accenture");

Replace the select options with:

    <option value="accenture">Accenture</option>
    <option value="capco">Capco</option>
    <option value="sage">Sage</option>

Add a label map instead of constructing the label from the first character:

    const COMPANY_LABELS: Record<Company, string> = {
      accenture: "Accenture",
      capco: "Capco",
      sage: "Sage"
    };

Use COMPANY_LABELS[company] in the heading.

When loading the summary:

- Keep the HTTP status check.
- Normalise string/object bullets as currently.
- Set only normalised.slice(0, SUMMARY_LIMIT).

Remove the showAllBullets state, its reset calls, visibleBullets, faded preview logic, and the “Show all”/“Show fewer” buttons. Render the returned five-or-fewer bullets directly.

Keep the article list unchanged so users can still read the full source material below the five key insights.

### 4.5 Update app/api/weekly-summary/route.ts

Replace the Microsoft/Sage validation with:

    company === "accenture" || company === "capco" || company === "sage"

Map the selected company to the new summary filenames:

    company_accenture.json
    company_capco.json
    company_sage.json

Return HTTP 400 for the removed Microsoft key. This makes stale clients fail clearly instead of silently serving an obsolete file.

Also slice the response to five bullets as a defensive API boundary, even though the generator and validator enforce the same rule.

### 4.6 Update scripts/check-data.mjs

Change DATASETS to:

    [
      ["hightech", "public/data/hightech.json", "public/data/summaries/hightech.json"],
      ["telecoms", "public/data/telecoms.json", "public/data/summaries/telecoms.json"],
      ["accenture", "public/data/company/accenture.json", "public/data/summaries/company_accenture.json"],
      ["capco", "public/data/company/capco.json", "public/data/summaries/company_capco.json"],
      ["sage", "public/data/company/sage.json", "public/data/summaries/company_sage.json"]
    ]

Add:

    const MAX_SUMMARY_BULLETS = 5;

Fail validation when a summary has more than five bullets. Continue validating that every summary URL belongs to the corresponding article dataset.

Add checks for:

- Duplicate article URLs within each dataset.
- Missing source values.
- Company URL host allowlists.
- A summary bullet URL that is not absolute.
- A summary bullet with a URL outside its dataset.

### 4.7 Add scripts/check-sources.mjs

Create a read-only source health check that imports the shared source registry and:

- Requests each RSS/Atom or sitemap endpoint with the same timeout and user-agent policy as ingestion.
- Reports HTTP status, content type, and item/entry count.
- Runs sitemap path filters and reports candidate counts.
- Fails only when all sources for a required category are unavailable or produce zero usable entries.
- Does not write to public/data.

Add to package.json:

    "check:sources": "node scripts/check-sources.mjs"

Use this command locally before changing the source registry and optionally as a separate manual GitHub Actions check. Do not make the daily workflow fail because one publisher temporarily blocks a request.

### 4.8 Update scripts/preview-newsletter.mjs

The current newsletter preview already renders five items, but it uses a 12-item ranked buffer because summaries previously contained up to ten bullets.

Update it to:

- Import or define the shared limit as five.
- Use a five-item ranked buffer when matching summary URLs.
- Keep the deterministic top-up logic.
- Ensure getTop5BulletsForTab can never return more than five.
- Keep the current high-tech and telecoms newsletter sections.

Company-specific content is not currently included in the newsletter. Do not add company sections as part of this change unless that is separately requested.

### 4.9 Update README.md

Replace the generic source/setup notes with a short newsroom-specific section covering:

- High Tech and Telecoms source categories.
- Accenture, Capco, and Sage company tabs.
- The five-insight rule.
- The difference between primary feeds/sitemaps and Google News fallbacks.
- npm run check:data.
- npm run check:sources.
- TEST_MODE=1 DRY_RUN=1 node scripts/ingest.mjs.

Document that the OPENAI_API_KEY is optional for fallback summaries, but API billing is separate from ChatGPT billing.

## 5. Generated data and removed files

After the code changes are complete, run a fresh test ingestion and then a normal ingestion.

Create and commit:

- public/data/company/accenture.json
- public/data/company/capco.json
- public/data/summaries/company_accenture.json
- public/data/summaries/company_capco.json

Regenerate and commit:

- public/data/company/sage.json
- public/data/summaries/company_sage.json
- public/data/hightech.json
- public/data/telecoms.json
- their summary files

Remove and commit deletion of:

- public/data/company/microsoft.json
- public/data/summaries/company_microsoft.json

Do not manually edit generated JSON to make it pass validation. Generate it from the new source registry so the source diagnostics and timestamps are representative.

## 6. Testing plan

### 6.1 Static and unit-level checks

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

If a test runner is added later, cover:

- Sitemap XML with one URL and multiple URLs.
- Sitemap filtering for Accenture /news/YYYY/.
- Sitemap filtering for Capco newsroom and Intelligence paths.
- Rejection of Capco careers and navigation URLs.
- Sitemap lastmod fallback when an article has no publication metadata.
- Article title/date replacement from extracted metadata.
- Exactly five summary inputs.
- Model output of ten bullets being reduced to five.
- Model output with invalid URLs being safely topped up.
- Microsoft API requests returning HTTP 400.

### 6.2 Safe ingestion test

Run:

    OPENAI_API_KEY="" TEST_MODE=1 DRY_RUN=1 node scripts/ingest.mjs

Expected results:

- No generated files are changed.
- Each category has at least one usable source item.
- Accenture and Capco sitemap sources produce filtered candidates.
- Diagnostics identify primary, sitemap, and fallback sources.
- Every summary reports no more than five bullets.
- The process exits successfully when at least one item exists in each required category.

Run git status --short afterwards to verify that dry-run mode did not modify generated files.

### 6.3 Data and API checks

After real generated data is committed:

    npm run check:data
    curl -i https://www.nivstechpulse.com/api/weekly-summary?tab=hightech
    curl -i https://www.nivstechpulse.com/api/weekly-summary?tab=telecoms
    curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=company&company=accenture'
    curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=company&company=capco'
    curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=company&company=sage'
    curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=company&company=microsoft'

Expected results:

- The first five endpoints return HTTP 200 and at most five bullets.
- The Microsoft endpoint returns HTTP 400.
- Each bullet URL links to an article in the matching dataset.

### 6.4 Browser QA

Check the deployed page at desktop and mobile widths:

- Company Specific defaults to Accenture.
- The dropdown contains Accenture, Capco, and Sage only.
- Switching companies updates both the article list and summary.
- Each summary shows no more than five cards.
- There is no “Show all” or “Show fewer” control.
- Full article lists still render below the summary.
- Accenture and Capco article links open the original first-party page.
- UK-relevant tags and the existing layout remain intact.
- Summary and article loading errors remain visible and understandable.

## 7. Workflow and deployment

No change is required to the existing GitHub Actions schedule, Vercel deployment, or Supabase heartbeat for this feature.

The implementation sequence should be:

1. Add the shared source registry and sitemap support.
2. Implement the five-item summary limit.
3. Update company types, API validation, and UI labels.
4. Update validation, source checks, newsletter preview, and README.
5. Run dry-run ingestion and source checks.
6. Run a real ingestion with the refreshed source registry.
7. Run npm run check:data and npm run build.
8. Commit code and generated data together.
9. Push to main; Vercel will deploy from the Git push.
10. Rerun the GitHub ingest workflow once after deployment to prove the scheduled path works with the new data.

Do not invoke the live weekly newsletter route for testing because it sends email. Use npm run preview:newsletter for visual newsletter checks.

## 8. Acceptance criteria

The change is complete when:

- The company selector contains Accenture, Capco, and Sage only.
- No Microsoft source, route, UI option, or generated file remains.
- Accenture data comes primarily from the official newsroom sitemap.
- Capco data comes primarily from the official sitemap with strict path filtering.
- Sage first-party feeds continue to work.
- GSMA improves Telecoms authority coverage.
- Duplicate and dead primary feed URLs are removed or clearly treated as fallbacks.
- Each summary is generated from at most five ranked articles.
- No summary/API/UI/newsletter path can emit more than five bullets.
- Full article datasets remain available.
- npm run check:data, npm run check:sources, and npm run build pass.
- A real GitHub Actions ingestion completes and produces a new data commit.
- The deployed site displays fresh Accenture and Capco content.

## 9. Risks and decisions

### Sitemap publication dates

Sitemap lastmod can represent an update rather than original publication. Prefer dates extracted from the article page and retain lastmod only as a fallback.

### Corporate content bias

Accenture and Capco first-party sources are authoritative for what the companies announce, but naturally promotional. Keep independent publishers in the broader High Tech and Telecoms categories and label all links with the actual source domain.

### Capco content mix

Capco Intelligence is valuable but includes long-form thought leadership rather than breaking news. Keep it in the Capco company tab, but add a source-kind tag internally so it can be separated later if readers want “news” and “insights” sub-tabs.

### Feed instability

Do not let one blocked or renamed publisher stop the entire daily ingestion. The required failure threshold should be category-level, with clear diagnostics and controlled fallbacks.

### OpenAI usage

Reducing model input from up to 60 articles to five should reduce token use and make summaries more focused. The number of category/company calls will be five per ingestion run: High Tech, Telecoms, Accenture, Capco, and Sage. Fallback summaries must continue to work if the API key is unavailable or API usage is blocked.

## 10. Research references

Source checks were performed on 26 August 2026:

- [Accenture Newsroom](https://newsroom.accenture.com/)
- [Accenture Newsroom sitemap](https://newsroom.accenture.com/sitemap.xml)
- [Capco Newsroom and Media](https://www.capco.com/about-us/newsroom-and-media)
- [Capco Intelligence](https://www.capco.com/intelligence)
- [Capco sitemap](https://www.capco.com/sitemap.xml)
- [GSMA RSS feeds](https://www.gsma.com/newsroom/rss-feeds/)
- [GSMA Newsroom feed](https://www.gsma.com/newsroom/feed/)
- [Ofcom News Centre](https://www.ofcom.org.uk/news-centre)

These references support the source choices. Availability should still be checked by npm run check:sources immediately before implementation and on future source changes.
