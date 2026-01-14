# Email Setup Guide

This project uses [Resend](https://resend.com) for all transactional emails:
- **League invitations** - sent via Edge Functions
- **Auth emails** - signup confirmation, password reset (via Supabase Auth)

## Setup Steps

### 1. Create a Resend Account

1. Sign up at https://resend.com (free tier: 3,000 emails/month)
2. Add and verify your sending domain
3. Create an API key from the dashboard

### 2. Configure Invitation Emails

Add your Resend credentials to `supabase/functions/.env`:

```env
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=Fantasy Reel <noreply@yourdomain.com>
```

### 3. Configure Supabase Auth Emails

In the Supabase Dashboard (or local Studio at http://127.0.0.1:54323):

1. Go to **Authentication** → **SMTP Settings**
2. Enable **Custom SMTP**
3. Enter the following:

| Setting | Value |
|---------|-------|
| Host | `smtp.resend.com` |
| Port | `465` |
| User | `resend` |
| Password | Your Resend API key |
| Sender email | `noreply@yourdomain.com` |
| Sender name | `Fantasy Reel` |

## Local Development

For local development without Resend configured:

- **Auth emails** (signup, password reset) are captured by Inbucket at http://127.0.0.1:54324
- **Invitation emails** will log the invite URL to the console instead of sending

## Troubleshooting

### Emails not sending?
- Verify `RESEND_API_KEY` is set in `supabase/functions/.env`
- Check Edge Function logs for errors
- Ensure your sending domain is verified in Resend

### Auth emails not arriving?
- Check Supabase Dashboard → Authentication → SMTP Settings
- Verify the API key is correct (use as password)
- Check spam folder

### Rate limits
- Resend free tier: 3,000 emails/month, 100/day
- Supabase Auth default: 30 emails/hour (adjustable in Auth settings)
