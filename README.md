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
SEARXNG_URL=http://localhost:8080
GOOGLE_SHEETS_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=

# Optional: protect the entire app with basic auth
BASIC_AUTH_USER=
BASIC_AUTH_PASSWORD=
```

3. Run the app:

```bash
npm run dev
```

4. Open http://localhost:3000

## Google Sheets Setup

JobPilot stores scraped jobs in Google Sheets. Set it up once:

1. Create a new Google Sheet and copy the Sheet ID from the URL.
2. Create a Google Cloud project and enable the Google Sheets API.
3. Create a Service Account and download the JSON key.
4. Share the Sheet with the service account email (Editor access).
5. Set these env vars:

```bash
GOOGLE_SHEETS_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

Tip: For .env.local, put the JSON on a single line. If you paste a multiline JSON, replace newlines with \n.

Google Sheets is optional. JobPilot now supports three storage modes:

- `local` (default): stores jobs in `jobs-db.json`
- `sheets`: reads/writes jobs in Google Sheets only
- `hybrid`: writes to local DB and attempts Sheets sync

Configure with either:

- Settings page -> Default Search -> Storage mode
- `JOB_STORE_MODE=local|sheets|hybrid` in `.env.local`

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
