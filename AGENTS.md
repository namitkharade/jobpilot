# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

JobPilot is a Next.js 16 App Router application for AI-assisted job search automation. It scrapes jobs from LinkedIn/Indeed via Apify, tracks applications, scores resumes against job descriptions using OpenAI, finds recruiter emails via Hunter.io, and generates personalized outreach drafts. Scheduled automation runs via Vercel Cron.

## Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Architecture

### Storage Layer (`lib/job-store.ts`)
Jobs are stored in one of three modes, configurable via `JOB_STORE_MODE` env var or Settings page:
- `local`: jobs-db.json file (default, local only)
- `sheets`: Google Sheets only (requires Google Sheets API setup)
- `hybrid`: local file + Sheets sync (Vercel auto-falls back to sheets if configured)

On Vercel, if `local` mode is set but Google Sheets is configured, it automatically uses `sheets` mode.

### Key API Routes (`app/api/`)
- `/api/scrape` - Job scraping via Apify actors (LinkedIn/Indeed)
- `/api/jobs` - CRUD for job listings
- `/api/ats` - Resume ATS scoring against job descriptions using OpenAI
- `/api/recruiter` - Find recruiters for a company via SearXNG search
- `/api/email` - Draft personalized cold outreach emails using OpenAI
- `/api/cron` - Vercel Cron endpoint (runs daily at 8am UTC, triggers scrape + ATS for new jobs)
- `/api/config` - Read/write config.json for search defaults and API keys
- `/api/resume` - Resume upload/cache/status endpoints
- `/api/cover-letter` - Generate and compile cover letters (LaTeX)

### External Services
- **Apify**: `curious_coder/linkedin-jobs-scraper` and `misceres/indeed-scraper` actors for job scraping
- **OpenAI**: GPT-4o for ATS scoring, email drafting, resume tailoring
- **SearXNG**: Free metasearch for recruiter research (uses public instances or custom `SEARXNG_URL`)
- **Hunter.io**: Email finding API for recruiters
- **Google Sheets**: Optional job storage (requires service account JSON)

### Frontend Structure
- `app/page.tsx` - Main dashboard with job table, ATS panel, recruiter outreach
- `app/jobs/[id]/page.tsx` - Individual job detail page
- `app/settings/page.tsx` - Configuration for search defaults, API keys, cron
- `app/resume/page.tsx` - Resume editor and LaTeX compilation
- `components/` - React components (JobTable, ResumeEditor, RecruiterPanel, EmailDrafter, etc.)

### Configuration
- `config.json` stores user preferences (search query/location, API keys, cron enabled state)
- `.env.local` for environment variables (see `.env.local.example`)
- `.resume-cache.json` caches parsed resume text and tailored versions

## Key Files

| File | Purpose |
|------|---------|
| `lib/apify.ts` | Apify actor calls for LinkedIn/Indeed scraping |
| `lib/openai.ts` | OpenAI GPT-4o calls, resume cache management |
| `lib/sheets.ts` | Google Sheets API integration |
| `lib/hunter.ts` | Hunter.io email finding |
| `lib/searxng.ts` | SearXNG metasearch for recruiter research |
| `types/index.ts` | TypeScript types for JobListing, ATS results, etc. |

## Environment Variables

Required for full functionality:
- `OPENAI_API_KEY` - ATS scoring, email generation
- `APIFY_API_TOKEN` - Job scraping
- `HUNTER_API_KEY` - Email finding
- `GOOGLE_SHEETS_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON` - Sheets storage (optional)
- `SEARXNG_URL` - Custom SearXNG instance (optional, uses public fallbacks)
- `CRON_SECRET` - Protect manual cron triggers (optional)
- `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD` - App-wide basic auth (optional)

## Deployment

Deployed to Vercel with cron configuration in `vercel.json` (runs `/api/cron` daily at 8am UTC). See DEPLOYMENT.md for setup steps.