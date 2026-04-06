# JobPilot

JobPilot is an AI-assisted job search workspace that helps you:

- Scrape jobs from LinkedIn and Indeed.
- Track applications in a dashboard.
- Score roles against your resume with ATS analysis.
- Find likely recruiters and discover their email addresses.
- Generate personalized cold outreach drafts.
- Run scheduled daily automation with Vercel Cron.

## Search
JobPilot uses a self-hosted SearXNG instance on Hugging Face Spaces.
No API key or configuration needed - it works out of the box.
Optionally override with your own instance via SEARXNG_URL in .env.local.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment variables in .env.local:

- OpenAI API key: https://platform.openai.com/api-keys

```bash
OPENAI_API_KEY=
APIFY_API_TOKEN=
DATABASE_URL=
# Optional fallback name if your provider gives POSTGRES_URL
POSTGRES_URL=
SEARXNG_URL=http://localhost:8080

# Optional: protect the entire app with basic auth
BASIC_AUTH_USER=
BASIC_AUTH_PASSWORD=
```

3. Run the app:

```bash
npm run dev
```

4. Open http://localhost:3000

## Postgres Setup (Persistent)

JobPilot now uses PostgreSQL for permanent storage in local + deployed environments.

1. Create a managed Postgres database (Neon via Vercel Marketplace is the easiest path).
2. Add the connection string to env:

```bash
DATABASE_URL=postgres://...
```

3. Migrate your existing local data once:

```bash
npm run migrate:local-to-postgres
```

4. Deploy with the same `DATABASE_URL` in Vercel production env vars.

Notes:
- If `DATABASE_URL`/`POSTGRES_URL` is missing, JobPilot falls back to local `jobs-db.json`.
- Legacy `JOB_STORE_MODE=sheets|hybrid` values are mapped to `postgres`.

## Cron Automation

- Vercel cron path: /api/cron
- Schedule: 0 8 * * *
- Logs endpoint: /api/cron/logs (last 7 days)

Default query/location and cron enabled state are stored in config.json.
Run logs are stored in logs.json.

## Settings Page

The /settings page includes:

- Default search query and location
- API key save/test controls for Apify and Hunter.io
- Resume cache status and clear/re-upload actions
- Cron toggle plus last run/result details

## Screenshot Placeholders

- Dashboard screenshot: ./public/screenshots/dashboard.png
- Job detail screenshot: ./public/screenshots/job-detail.png
- Settings screenshot: ./public/screenshots/settings.png

(Place your screenshots at those paths.)

## Deployment

Deployment steps are documented in DEPLOYMENT.md.
