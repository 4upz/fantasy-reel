# Production Deployment Guide

This guide covers deploying Fantasy Reel to production using Supabase (backend) and Vercel (frontend).

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`npm install -g supabase`)
- [Vercel CLI](https://vercel.com/docs/cli) installed (`npm install -g vercel`)
- A Supabase account at https://supabase.com
- A Vercel account at https://vercel.com
- API keys for external services (see below)

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────────────────────┐
│   Vercel        │     │   Supabase Cloud                 │
│                 │     │                                  │
│  Next.js App    │────▶│  PostgreSQL + RLS                │
│  Cron Jobs      │     │  Edge Functions (25)             │
│                 │     │  Auth (Email + Discord OAuth)    │
│                 │     │  Realtime Subscriptions          │
│                 │     │  Storage (Avatars)               │
└─────────────────┘     └──────────────────────────────────┘
         │                          │
         │                          ▼
         │              ┌──────────────────────┐
         └─────────────▶│  External APIs       │
                        │  - TMDb (movies)     │
                        │  - MDBList (scores)  │
                        │  - Resend (email)    │
                        └──────────────────────┘
```

---

## Step 1: Obtain API Keys

Before deploying, gather these API keys:

| Service | Purpose | Get Key From |
|---------|---------|--------------|
| **TMDb** | Movie discovery, search, posters | https://www.themoviedb.org/settings/api |
| **MDBList** | Movie ratings (RT drives scoring; IMDb/Metacritic display-only) | https://mdblist.com/preferences/ |
| **Resend** | Email notifications | https://resend.com/api-keys |
| **Discord** | OAuth authentication | https://discord.com/developers/applications |

### Discord OAuth Setup

1. Create a new application at https://discord.com/developers/applications
2. Go to OAuth2 → General
3. Add redirect URL: `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. Copy **Client ID** and **Client Secret**

---

## Step 2: Supabase Cloud Setup

### 2.1 Create or Link Project

**Current Production Project:** `hgsusrgryybxsdjzlydq`

If you don't have a Supabase project yet:
```bash
# Create a new project via CLI
npx supabase projects create <project-name> --org-id <your-org-id> --db-password <secure-password> --region us-east-1

# Or create via dashboard at https://supabase.com/dashboard
# Then link it:
npx supabase link --project-ref <your-project-ref>
```

If you already have a project (current: `hgsusrgryybxsdjzlydq`):
```bash
npx supabase link --project-ref hgsusrgryybxsdjzlydq
```

### 2.2 Push Database Schema

```bash
# Push all migrations to production
npx supabase db push

# Verify migrations applied
npx supabase migration list
```

### 2.3 Deploy Edge Functions

```bash
# Deploy all functions at once
npx supabase functions deploy

# Or deploy individually
npx supabase functions deploy create-league
npx supabase functions deploy draft-pick
# ... etc
```

### 2.4 Configure Secrets

In Supabase Dashboard → Project Settings → Edge Functions → Secrets, add:

| Secret Name | Description |
|-------------|-------------|
| `SITE_URL` | **REQUIRED** - Production domain URL (e.g., `https://fantasyreel.com`) - used in invite links |
| `TMDB_API_KEY` | TMDb API read access token (JWT format) |
| `MDBLIST_API_KEY` | MDBList API key |
| `RESEND_API_KEY` | **REQUIRED** - Resend API key for emails (invitations, notifications) |
| `RESEND_FROM_EMAIL` | Sender email (e.g., `Fantasy Reel <noreply@yourdomain.com>`) |
| `CRON_SECRET` | Random string for Vercel cron auth (generate with `openssl rand -hex 32`) |
| `SENTRY_DSN` | Optional; enables error tracking in Edge Functions |
| `OPS_DISCORD_WEBHOOK_URL` | Optional; Discord webhook URL for a private ops channel — receives alerts for failed/partial cron runs and repeatedly-failing league webhooks |

Or via CLI:
```bash
npx supabase secrets set SITE_URL=https://your-production-domain.com
npx supabase secrets set TMDB_API_KEY=your_key
npx supabase secrets set MDBLIST_API_KEY=your_key
npx supabase secrets set RESEND_API_KEY=your_key
npx supabase secrets set RESEND_FROM_EMAIL="Fantasy Reel <noreply@yourdomain.com>"
npx supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
npx supabase secrets set SENTRY_DSN=your_sentry_dsn
npx supabase secrets set OPS_DISCORD_WEBHOOK_URL=your_ops_discord_webhook_url
```

### 2.5 Configure Authentication

In Supabase Dashboard → Authentication:

**URL Configuration:**
- Site URL: `https://your-production-domain.com`
- Redirect URLs: Add your production domain

**Providers → Discord:**
- Enable Discord provider
- Enter Client ID and Client Secret from Discord Developer Portal
- Redirect URL is auto-generated: `https://<project-ref>.supabase.co/auth/v1/callback`

### 2.6 Enable Realtime

In Supabase Dashboard → Database → Replication, enable for:
- `leagues`
- `draft_picks`
- `league_participants`
- `team_scores`
- `movies`
- `pickup_bids`
- `trades`

### 2.7 Create Storage Bucket

In Supabase Dashboard → Storage:
1. Create bucket named `avatars`
2. Set to **Public** bucket
3. RLS policies are already included in migrations

---

## Step 3: Vercel Deployment

### 3.1 Connect Repository

```bash
# From project root
cd apps/frontend
vercel

# Follow prompts to:
# - Link to existing project or create new
# - Set root directory to apps/frontend
```

Or connect via Vercel Dashboard:
1. Go to https://vercel.com/new
2. Import your Git repository
3. Set **Root Directory** to `apps/frontend`
4. Framework Preset: Next.js

### 3.2 Configure Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Value | Environment |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase dashboard | Production |
| `TMDB_API_KEY` | Your TMDb API key | Production |
| `MDBLIST_API_KEY` | Your MDBList API key | Production |
| `CRON_SECRET` | Same value as Supabase secret | Production |

### 3.3 Configure Custom Domain (Optional)

1. Vercel Dashboard → Project → Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed
4. Update Supabase Auth Site URL to match

### 3.4 Verify Cron Jobs

Vercel automatically picks up cron configuration from `vercel.json`:
- `process-bids` runs weekly (Saturdays) and hourly for extended processing

Check Vercel Dashboard → Project → Settings → Cron Jobs to verify.

**Note:** `process-trades` now runs via Vercel Cron (every 5 minutes) instead of the previous Supabase pg_cron job. The `20260807000000_add_job_runs.sql` migration unschedules the old pg_cron job, so deploy that migration (`npx supabase db push`) alongside the frontend deployment that adds the Vercel cron entry — otherwise the job either runs twice (both schedulers active) or not at all (pg_cron removed before the Vercel cron exists).

---

## Step 4: Post-Deployment Verification

### Checklist

```
□ Authentication
  □ Email signup/login works
  □ Email confirmation emails arrive
  □ Discord OAuth login works
  □ Password reset works

□ League Management
  □ Create league works
  □ Join league via invitation works
  □ League settings update works

□ Draft System
  □ Movie search returns results (TMDb API)
  □ Draft picks save correctly
  □ Real-time updates work (other users see picks)
  □ Draft order calculates correctly

□ Bidding System
  □ Place bid works
  □ Outbid notifications sent (Resend)
  □ Bid processing cron runs

□ Scoring
  □ Score updates fetch from MDBList
  □ Team totals calculate correctly
  □ Standings update in real-time

□ Storage
  □ Avatar upload works
  □ Avatars display correctly
```

### Monitor Logs

**Edge Function Logs:**
```bash
npx supabase functions logs --project-ref <your-project-ref>
```

**Vercel Logs:**
- Dashboard → Project → Deployments → Select deployment → Functions tab

---

## Troubleshooting

### Edge Functions Return 500

1. Check function logs: `npx supabase functions logs <function-name>`
2. Verify secrets are set: `npx supabase secrets list`
3. Check CORS configuration matches your domain

### Auth Redirect Issues

1. Verify Site URL in Supabase Auth settings
2. Check redirect URLs include your domain
3. For Discord OAuth, verify redirect URL in Discord Developer Portal

### Real-time Not Working

1. Verify table replication is enabled in Supabase Dashboard
2. Check browser console for WebSocket errors
3. Verify RLS policies allow SELECT for the user

### Cron Jobs Not Running

1. Check Vercel Dashboard → Cron Jobs for execution logs
2. Verify `CRON_SECRET` matches between Vercel and Supabase
3. Check Edge Function logs for errors

### Movie Search Returns Empty

1. Verify `TMDB_API_KEY` is set correctly
2. Test API key directly: `curl -H "Authorization: Bearer $TMDB_API_KEY" "https://api.themoviedb.org/3/movie/popular"`

---

## Rollback Procedures

### Database Rollback

```bash
# List migrations
npx supabase migration list

# Rollback requires manual SQL or restoring from backup
# Contact Supabase support for point-in-time recovery
```

### Frontend Rollback

```bash
# Via Vercel CLI
vercel rollback

# Or in Dashboard: Deployments → Previous deployment → Promote to Production
```

### Edge Functions Rollback

```bash
# Deploy previous version from git
git checkout <previous-commit>
npx supabase functions deploy
```

---

## Security Checklist

- [ ] CORS restricted to production domain (see `supabase/functions/_shared/cors.ts`)
- [ ] All secrets stored in Supabase/Vercel, not in code
- [ ] RLS policies enabled on all tables
- [ ] JWT verification enabled for Edge Functions
- [ ] Rate limiting configured in Supabase Auth
- [ ] HTTPS enforced (automatic with Vercel/Supabase)

---

## Maintenance

### Regular Tasks

- **Weekly:** Check Edge Function error logs
- **Monthly:** Review Supabase usage/quotas
- **Quarterly:** Rotate API keys, update dependencies

### Updating Production

```bash
# 1. Test locally
npm run dev
npm run test:functions

# 2. Push database changes (if any)
npx supabase db push

# 3. Deploy Edge Functions (if changed)
npx supabase functions deploy

# 4. Deploy frontend (automatic on git push, or manual)
vercel --prod
```

---

## Cost Estimates

### Supabase (Free Tier Limits)
- 500MB database
- 1GB file storage
- 2GB bandwidth
- 500K Edge Function invocations

### Vercel (Free Tier Limits)
- 100GB bandwidth
- Serverless Function execution limits
- 1 cron job (Pro plan for more)

For a small league (< 100 users), free tiers should be sufficient.

---

## Support

- Supabase: https://supabase.com/docs
- Vercel: https://vercel.com/docs
- Project Issues: https://github.com/your-repo/issues
