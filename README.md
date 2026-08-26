# Nivs Tech & Telecoms Pulse

Nivs Newsroom is a Next.js site that publishes a ranked weekly view of UK-relevant technology and telecoms news.

## Content areas

- High Tech: CNET, TechCrunch, The Verge, 9to5Google, and 9to5Mac.
- Telecoms: Telecoms Tech News, Total Telecom, RCR Wireless, GSMA, and UK DSIT.
- Company Specific: Accenture, Capco, and Sage.

Accenture and Capco use first-party sitemap discovery. Sage uses its first-party RSS feed. Google News RSS is used only as a controlled fallback when a configured primary source fails.

## Summary behaviour

Each category and company retains its full ranked article dataset, but the AI summary is generated from the top five ranked articles only. The API, website, newsletter, and fallback summaries all enforce a maximum of five insight bullets.

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
