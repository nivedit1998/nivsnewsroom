# Nivs Newsroom — Implementation and Recovery Plan

**Status:** Implementation applied locally; external Supabase migration, environment configuration, and production verification remain.

**Objective:** Restore reliable daily article ingestion, make the live site current, resume Supabase-backed newsletter features, and add a controlled daily Supabase heartbeat so the database receives real application activity.

## 1. Current state and diagnosis

The repository and deployment are not completely down:

- The live homepage and public data/summary endpoints return successfully.
- The local Next.js production build passes.
- The workflow YAML and JSON data files validate.
- The live site is serving data generated on **14 May 2026**.
- The remote `main` branch also stops at automated data commit `337891e` on **14 May 2026**. There are no later refresh commits.
- The local checkout is 40 commits behind the remote branch and must not be used as the starting point for implementation until it is synchronised.
- Current feed checks found two source problems: Light Reading returns 404 and Sage Newsroom returns 403. The ingester currently catches these errors, so they reduce coverage but should not stop the complete workflow.
- The actual private GitHub Actions failure log still needs to be opened. The code audit alone cannot distinguish a disabled workflow, missing secret, permission failure, or a runtime failure.

The current automation is defined in:

- `.github/workflows/ingest.yml`
- `scripts/ingest.mjs`
- `vercel.json`
- `app/api/newsletter/weekly/route.ts`
- `lib/supabaseAdmin.ts`
- `lib/ses.ts`

## 2. Recovery order

Implement in this order:

1. Resume/verify the Supabase project and record its project status.
2. Synchronise the local checkout with remote `main`.
3. Add the Supabase heartbeat table and protected heartbeat route.
4. Harden the ingestion script and GitHub workflow.
5. Replace the committed Vercel cron query token with Vercel's `CRON_SECRET` authorization header.
6. Deploy once, run controlled smoke tests, then run one manual ingestion.
7. Confirm fresh data, newsletter behaviour, and the first scheduled runs.

Do not run a real newsletter test until the recipient address is explicitly selected. The weekly endpoint sends email.

## 3. Supabase recovery and heartbeat

### 3.1 Resume and verify the project manually

In Supabase Studio:

1. Resume the paused project.
2. Confirm the project URL has returned to an active state.
3. Confirm the `subscribers` table exists with at least these columns:
   - `email`
   - `token`
   - `status`
   - `confirmed_at`
   - `unsubscribed_at`
4. Confirm the service-role key is available for the Vercel Production environment.
5. Never place the service-role key in client-side code or a committed file.

Supabase currently documents that Free Plan projects can pause after low database activity over a seven-day period. A heartbeat is a mitigation, not an absolute guarantee; if the project continues to pause, move it to a paid plan or use the provider's recommended project-activity option.

Reference: <https://supabase.com/docs/guides/platform/free-project-pausing>

### 3.2 Add a singleton heartbeat table

Create `supabase/migrations/20260826_create_system_heartbeat.sql`:

```sql
create table if not exists public.system_heartbeat (
  id text primary key check (id = 'main'),
  last_seen_at timestamptz not null default now(),
  source text not null default 'vercel-cron',
  updated_at timestamptz not null default now()
);

alter table public.system_heartbeat enable row level security;

-- This table is for server-side health activity only.
revoke all on table public.system_heartbeat from anon, authenticated;
grant all on table public.system_heartbeat to service_role;

insert into public.system_heartbeat (id, last_seen_at, source, updated_at)
values ('main', now(), 'migration', now())
on conflict (id) do update set
  last_seen_at = excluded.last_seen_at,
  source = excluded.source,
  updated_at = excluded.updated_at;
```

This intentionally keeps **one row**. Each run uses an upsert, so the database does not accumulate an unlimited number of artificial rows.

### 3.3 Add a protected Vercel heartbeat route

Create `app/api/cron/supabase-heartbeat/route.ts`:

```ts
export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("system_heartbeat")
    .upsert(
      { id: "main", last_seen_at: now, source: "vercel-cron", updated_at: now },
      { onConflict: "id" }
    )
    .select("id,last_seen_at,source,updated_at")
    .single();

  if (error) {
    console.error("Supabase heartbeat failed", error);
    return NextResponse.json({ error: "Supabase heartbeat failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, heartbeat: data });
}
```

The route must never be publicly callable with the service-role key or a query-string secret.

### 3.4 Add the heartbeat to `vercel.json`

Replace the current weekly cron entry's query-string token and add a daily heartbeat:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/newsletter/weekly",
      "schedule": "00 10 * * 1"
    },
    {
      "path": "/api/cron/supabase-heartbeat",
      "schedule": "15 03 * * *"
    }
  ]
}
```

Vercel Cron uses UTC. The heartbeat is daily at 03:15 UTC; the newsletter remains Monday at 10:00 UTC. Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured.

Reference: <https://vercel.com/docs/cron-jobs/manage-cron-jobs>

### 3.5 Required Vercel environment variables

Set these in Vercel Production, Preview only where appropriate, and Development where local testing is required:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
SES_FROM
SES_REPLY_TO
PUBLIC_SITE_URL
CRON_SECRET
```

`CRON_SECRET` must be a new random value of at least 16 characters. After deployment, remove the old committed query-string token from `vercel.json` and rotate it if it was used anywhere else.

## 4. Supabase client and newsletter route hardening

### 4.1 Improve `lib/supabaseAdmin.ts`

Replace non-null assertions with explicit configuration errors:

```ts
import { createClient } from "@supabase/supabase-js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const supabaseAdmin = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE"),
  { auth: { persistSession: false } }
);
```

This makes a missing Vercel variable immediately visible in logs instead of producing an opaque Supabase error.

### 4.2 Update `app/api/newsletter/weekly/route.ts`

Replace the current query-token plus user-agent guard with the Vercel bearer-token guard:

```ts
function guard(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return { allowed: false, reason: "bad_cron_secret" };
  }

  return { allowed: true, reason: "ok" };
}
```

Keep the existing recipient lookup and `sendBulk` behaviour, but change partial email failures to HTTP 500:

```ts
if (result.failed.length) {
  console.error("Newsletter partial failure", result.failed);
  return NextResponse.json(
    { ok: false, sent: result.ok, failed: result.failed.length },
    { status: 500 }
  );
}
```

This prevents a cron invocation from appearing successful when some messages failed.

### 4.3 Improve confirm/unsubscribe routes

In `app/api/newsletter/confirm/route.ts` and `app/api/newsletter/unsubscribe/route.ts`:

- Add a shared `getPublicSiteUrl()` helper that validates `PUBLIC_SITE_URL`.
- Do not call `new URL(..., undefined)` when the variable is missing.
- Return/log the Supabase error from unsubscribe instead of silently returning success when the database is unavailable.

## 5. Ingestion script changes

### 5.1 Add feed timeout and retry handling to `scripts/ingest.mjs`

Add near the existing settings:

```js
const FEED_TIMEOUT_MS = 20_000;
const FEED_RETRIES = 2;
```

Add a timeout wrapper and retry helper:

```js
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function parseFeedWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= FEED_RETRIES; attempt += 1) {
    try {
      return await withTimeout(parser.parseURL(url), FEED_TIMEOUT_MS, url);
    } catch (error) {
      lastError = error;
      if (attempt < FEED_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}
```

Change `parseFeed()` to call `parseFeedWithRetry(url)`. Keep `getFeedItems()` as the per-feed error boundary so one broken publisher cannot terminate the whole run.

### 5.2 Repair feed fallbacks

Add these entries to `FEED_FALLBACKS`:

```js
"https://www.lightreading.com/rss_simple.asp":
  "https://news.google.com/rss/search?q=site:lightreading.com&hl=en-GB&gl=GB&ceid=GB:en",
"https://www.sage.com/en-gb/newsroom/feed/":
  "https://news.google.com/rss/search?q=site:sage.com%20newsroom&hl=en-GB&gl=GB&ceid=GB:en",
```

Review duplicate telecom feeds and keep only one working URL per publisher unless they intentionally provide different content. This reduces duplicate extraction and runtime.

### 5.3 Add run-level diagnostics

Track and print, for every feed:

- feed URL;
- primary item count;
- fallback used;
- final item count;
- extraction failures;
- summary mode: OpenAI or fallback.

The run should fail if all four content groups produce zero items. A single empty group should be recorded as a warning and should not block the other groups.

### 5.4 Add non-destructive data validation

Create `scripts/check-data.mjs` to validate:

- all eight expected JSON files parse;
- article arrays contain `title` and absolute `url` fields;
- summary files contain a `bullets` array;
- summary URLs, when present, belong to the corresponding article dataset;
- generated timestamps are valid;
- at least one content group contains articles.

Add to `package.json`:

```json
"check:data": "node scripts/check-data.mjs"
```

Run it after ingestion and before committing generated files.

## 6. GitHub Actions repair

### 6.1 Repository settings to verify

In GitHub:

1. Confirm Actions are enabled for the repository.
2. Confirm .github/workflows/ingest.yml exists on the default branch.
3. Confirm the workflow is not disabled after inactivity.
4. Confirm the repository's default branch is main.
5. Confirm the OPENAI_API_KEY Actions secret exists and is current.
6. Confirm the workflow's GITHUB_TOKEN is allowed to write contents and that branch protection does not reject bot pushes.
7. Open the latest failed run and record the failed step before changing unrelated code.

### 6.2 Replace .github/workflows/ingest.yml with a more observable workflow

Keep the existing daily schedule and manual dispatch, but use:

~~~yaml
name: Daily ingest & publish JSON

on:
  schedule:
    - cron: "30 8 * * *"
  workflow_dispatch:
    inputs:
      test_mode:
        description: "Use a small feed sample"
        required: false
        default: "0"

permissions:
  contents: write

concurrency:
  group: ingest-main
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      LOOKBACK_DAYS: "7"
      TEST_MODE: ${{ github.event_name == 'workflow_dispatch' && inputs.test_mode || '0' }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20.x"
          cache: "npm"

      - name: Install dependencies
        run: npm ci --no-audit --no-fund

      - name: Validate current data
        run: npm run check:data

      - name: Generate JSON
        run: node scripts/ingest.mjs

      - name: Validate generated data
        run: npm run check:data

      - name: Commit and push generated data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/data
          if git diff --cached --quiet; then
            echo "No generated data changes."
            exit 0
          fi
          git commit -m "chore(data): refresh news JSON [skip ci]"
          git push origin HEAD:main
~~~

If the failed run shows a push rejection, add a controlled fetch/rebase immediately before the commit. Do not use git push --force.

The [skip ci] suffix is safe here because the workflow is schedule-driven; it prevents the generated commit from recursively triggering another run.

### 6.3 Keep the heartbeat independent

The daily Vercel heartbeat is independent of GitHub Actions. Do not add a second Supabase writer to GitHub unless the Action logs show that Vercel Cron is unavailable. Two independent daily writers are unnecessary because the Supabase operation is an upsert to one row.

## 7. Front-end and API checks

The front-end data paths currently map correctly:

- High Tech → /data/hightech.json
- Telecoms → /data/telecoms.json
- Microsoft → /data/company/microsoft.json
- Sage → /data/company/sage.json

After the first fresh ingestion, verify all four paths and all four summary requests. Keep the existing no-store fetch behaviour so stale JSON is not held by the browser.

Add a small visible error state for summary API failures. The current summary loader silently catches errors, which can make a broken dependency or deployment look like an empty summary.

## 8. Safe test sequence

Run from a clean checkout after synchronising with remote main:

~~~bash
npm ci
npm run check:data
npm run build
node --check scripts/ingest.mjs
node --check scripts/preview-newsletter.mjs
~~~

Add a DRY_RUN=1 path to scripts/ingest.mjs before testing locally. In dry-run mode, print generated counts and summaries but do not write public/data.

Then verify:

~~~bash
curl -i https://www.nivstechpulse.com/
curl -i https://www.nivstechpulse.com/data/hightech.json
curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=hightech'
curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=telecoms'
curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=company&company=microsoft'
curl -i 'https://www.nivstechpulse.com/api/weekly-summary?tab=company&company=sage'
~~~

Expected protected-route results:

- /api/run-ingest without its secret → 401.
- Newsletter cron endpoint without Authorization → 401.
- Supabase heartbeat endpoint without Authorization → 401.
- Newsletter cron with the correct Vercel CRON_SECRET → run only in a controlled test window because it can send email.
- Supabase heartbeat with the correct CRON_SECRET → 200 and one updated system_heartbeat row.

For newsletter testing, use the existing mode=test&to=... path only after confirming the route's authorization and choosing a real test recipient. Verify the email arrives before enabling the weekly schedule.

## 9. Deployment acceptance criteria

The fix is complete only when all of these are true:

- The Supabase project is resumed and system_heartbeat contains exactly one row with a recent last_seen_at.
- The daily Vercel heartbeat returns 200 in Vercel logs.
- The next manual GitHub ingestion run is green.
- A new commit appears on main with current generated data.
- The live article data has a current generatedAt/published date rather than 14 May 2026.
- High Tech, Telecoms, Microsoft, and Sage tabs each load correctly.
- Subscription creates a pending subscriber and sends confirmation email.
- Confirmation changes the subscriber to active.
- Unsubscribe changes the subscriber to unsubscribed.
- A controlled weekly newsletter test sends successfully.
- The weekly Vercel cron uses CRON_SECRET, not a committed query-string token.
- No secrets appear in Git history, generated JSON, Action logs, or client bundles.
- The next seven days of scheduler logs show successful heartbeat and ingestion activity.

## 10. Rollback and safety

- Keep the existing main branch available until the first successful deployment is verified.
- Do not force-push or reset the repository.
- Do not run the newsletter endpoint with cron authorization unless an email send is intended.
- If the heartbeat returns Supabase's paused-project response, resume the project first; repeated retries cannot operate against a paused database.
- If Free Plan pausing continues despite daily activity, use a paid plan rather than adding unbounded fake rows.
