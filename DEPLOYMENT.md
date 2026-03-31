# JobPilot Vercel Deployment

## 1) Authenticate

```bash
vercel login
```

## 2) Add Environment Variables

Run the following commands and paste each value when prompted:

```bash
vercel env add OPENAI_API_KEY production
vercel env add APIFY_API_TOKEN production
vercel env add HUNTER_API_KEY production
vercel env add GOOGLE_SHEETS_ID production
vercel env add GOOGLE_SERVICE_ACCOUNT_JSON production
```

Optional (if you want a protected manual cron trigger policy):

```bash
vercel env add CRON_SECRET production
```

# SearXNG (optional — only needed if using your own instance)
# Leave unset to use the built-in public instance fallback list
vercel env add SEARXNG_URL production


## 3) Deploy to Production

```bash
vercel deploy --prod
```

## Search (No API Key Required)
JobPilot uses SearXNG for recruiter research — a free, open-source
metasearch engine. No account or API key is needed.

By default, JobPilot uses a curated list of public SearXNG instances
with JSON format enabled (verified from https://searx.space).

Optional: run your own instance for maximum reliability:
  docker run -d -p 8080:8080 searxng/searxng
Then set SEARXNG_URL=http://localhost:8080 in .env.local

## 4) Verify Cron

The cron schedule is configured in vercel.json:

- Path: /api/cron
- Schedule: 0 8 * * *

After deploy, verify in the Vercel Dashboard:

1. Project -> Settings -> Cron Jobs
2. Confirm /api/cron appears and is active
3. Trigger a manual run and inspect /api/cron/logs
