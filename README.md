# Nivs Tech, Telecoms & FinTech Pulse

Nivs Newsroom is a Next.js site that publishes a ranked weekly view of UK-relevant technology, telecoms, and FinTech news.

## Content areas

- High Tech: CNET, TechCrunch, The Verge, 9to5Google, and 9to5Mac.
- Telecoms: Telecoms Tech News, Total Telecom, RCR Wireless, and GSMA Newsroom.
- FinTech: Finextra Payments, The FinTech Times, Open Banking Limited, filtered FCA News, Payments Dive, and PYMNTS.
- Company Specific: Accenture, Capco, and Sage.

Accenture and Capco use first-party sitemap discovery. Sage uses its first-party RSS feed. Google News RSS is used only as a controlled fallback when a configured primary source fails.

## Summary behaviour

Each category and company retains its full ranked article dataset. Ranking uses deterministic editorial signals for category fit, impact, practical value, novelty, recency, UK relevance, source authority, cross-source corroboration, and low-signal penalties. Scores are not reader popularity figures or AI judgements. Analysis and feature labels do not receive an automatic ranking bonus.

High Tech and Telecoms summaries use a maximum of five selected ranked articles as AI context, with source diversity where enough sources are available. Company summaries use the top five ranked articles. FinTech uses a maximum of 10 ranked articles as context, capped at 400 words per article, and produces no more than five insights. FinTech is summarised with at most one AI request per ingestion run, with an input-fingerprint cache to avoid repeat calls when the top 10 has not changed.

AI explains the bounded selected stories in beginner-friendly plain English; it does not score every article. The normal full ingestion run makes at most six summary calls: High Tech, Telecoms, FinTech, Accenture, Capco, and Sage.

The API and website read saved summary JSON and do not call AI at page-view time. The LinkedIn page reuses the first three saved bullets for each category and does not call AI. If the OpenAI key is unavailable, deterministic fallback summaries are used. GOV.UK is intentionally excluded from the FinTech source list.

## Local development

Install dependencies and start the development server:

    npm ci
    npm run dev

Open http://localhost:3000.

## Ingestion and checks

Run the data validator:

    npm run check:data

Check configured RSS/Atom feeds and sitemaps without changing data:

    npm run check:sources

Run a safe, small ingestion test:

    OPENAI_API_KEY="" TEST_MODE=1 DRY_RUN=1 node scripts/ingest.mjs

Refresh only the FinTech dataset and summary when testing FinTech changes:

    INGEST_GROUP=fintech TEST_MODE=0 DRY_RUN=0 node scripts/ingest.mjs

Run the focused FinTech helper tests:

    npm run test:fintech

Run the deterministic ranking and summary-context tests:

    npm run test:insights

Generate a local newsletter preview:

    npm run preview:newsletter

The OPENAI_API_KEY is optional because the ingestion has deterministic fallback summaries. OpenAI API billing is separate from any ChatGPT subscription.

## Automation

GitHub Actions runs the daily ingestion workflow. Generated JSON is committed to the main branch, which triggers the Vercel deployment. Vercel Cron sends the weekly newsletter and writes the Supabase heartbeat.

Required GitHub Actions secret:

- OPENAI_API_KEY

Required Vercel environment variables:

- CRON_SECRET
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- AWS_REGION
- SES_FROM

Never commit local environment files or secret values.
