# OAuth Setup Guide

This guide explains how to configure OAuth authentication providers for Fantasy Reel.

## Discord OAuth Setup

Fantasy Reel supports Discord as an OAuth provider through Supabase's built-in authentication.

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name (e.g., "Fantasy Reel")
3. Navigate to the "OAuth2" section in the left sidebar

### 2. Configure OAuth2 Settings

In the OAuth2 section:

1. **Client ID**: Copy this value - you'll need it for configuration
2. **Client Secret**: Click "Reset Secret" to generate one, then copy it

3. **Add Redirect URIs**:
   - For local development: `http://127.0.0.1:54321/auth/v1/callback`
   - For production: `https://<your-project-ref>.supabase.co/auth/v1/callback`

   > Note: Use `127.0.0.1` (not `localhost`) for local development. The redirect URI uses Supabase's auth endpoint, not your frontend URL.

### 3. Configure Environment Variables

#### Local Development

Create or update `supabase/.env` with:

```bash
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
```

#### Production (Supabase Dashboard)

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** > **Providers**
3. Find **Discord** and toggle it on
4. Enter your Client ID and Client Secret
5. Save the configuration

### 4. Apply Database Migration

Run the migration to update the profile creation trigger:

```bash
# Local development
supabase db reset

# Or apply just the migration
supabase migration up
```

### 5. Test the Integration

1. Start your local Supabase: `supabase start`
2. Start the frontend: `npm run dev`
3. Navigate to `/login` or `/signup`
4. Click "Continue with Discord"
5. Authorize the application in Discord
6. You should be redirected back to the dashboard

## Google OAuth Setup

Fantasy Reel supports Google as an OAuth provider through Supabase's built-in authentication.

### 1. Create Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** > **Credentials**

### 2. Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose **External** user type (unless you have a Google Workspace organization)
3. Fill in the required fields:
   - **App name**: Fantasy Reel
   - **User support email**: Your email
   - **Developer contact email**: Your email
4. Add scopes:
   - `openid`
   - `email`
   - `profile`
5. Add test users if in testing mode

### 3. Create OAuth Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Web application** as the application type
4. Configure:
   - **Name**: Fantasy Reel (or your app name)
   - **Authorized redirect URIs**:
     - For local development: `http://127.0.0.1:54321/auth/v1/callback`
     - For production: `https://<your-project-ref>.supabase.co/auth/v1/callback`
5. Click **Create** and copy the **Client ID** and **Client Secret**

> Note: Use `127.0.0.1` (not `localhost`) for local development.

### 4. Configure Environment Variables

#### Local Development

Create or update `supabase/.env` with:

```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

#### Production (Supabase Dashboard)

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** > **Providers**
3. Find **Google** and toggle it on
4. Enter your Client ID and Client Secret
5. Save the configuration

### 5. Test the Integration

1. Restart local Supabase: `supabase stop && supabase start`
2. Start the frontend: `npm run dev`
3. Navigate to `/login` or `/signup`
4. Click "Continue with Google"
5. Complete the Google sign-in flow
6. You should be redirected back to the dashboard

---

## How It Works

### Authentication Flow

1. User clicks "Continue with Discord" button
2. User is redirected to Discord's OAuth consent page
3. After authorization, Discord redirects to Supabase's callback URL
4. Supabase exchanges the code for tokens and creates/updates the user
5. User is redirected to `/auth/callback` in the frontend
6. Frontend callback handler:
   - Exchanges the auth code for a session
   - Creates a profile if one doesn't exist (using Discord data)
   - Redirects to the dashboard

### Profile Data from OAuth Providers

When a user signs in with an OAuth provider, the following data is used:

| Provider | Display Name Source | Avatar Source |
|----------|---------------------|---------------|
| Discord | `global_name` or `username` | `avatar_url` |
| Google | `full_name` or `name` | `picture` |

Note: Google uses `picture` for avatar URLs while Discord uses `avatar_url`. The database triggers and auth callback handle both formats automatically.

### Database Trigger

The `handle_new_user()` trigger automatically creates profiles for new users:

- For email signup: Uses the `display_name` from signup form
- For OAuth: Extracts `global_name`, `full_name`, or `name` from provider metadata
- Avatar URL is synced from OAuth provider if available

## Troubleshooting

### "Invalid redirect URI" Error

Ensure your redirect URI in Discord Developer Portal exactly matches:
- Local: `http://127.0.0.1:54321/auth/v1/callback` (use `127.0.0.1`, not `localhost`)
- Production: `https://<project-ref>.supabase.co/auth/v1/callback`

### User Not Redirected After Login

Check that:
1. The `/auth/callback` route exists and is properly configured
2. `NEXT_PUBLIC_SUPABASE_URL` is correctly set
3. The site URL in Supabase config matches your frontend URL

### Profile Not Created

1. Check the database trigger exists: Run `supabase migration up`
2. Verify the `handle_new_user()` function is up to date
3. Check Supabase logs for any errors

### Avatar Not Showing

- Discord avatars are external URLs
- Ensure your `Avatar` component handles external URLs (not just Supabase storage paths)
- The OAuth sync trigger updates avatars on subsequent logins

## Adding More OAuth Providers

Supabase supports many OAuth providers (GitHub, GitLab, Apple, Azure, Twitch, and more). To add another:

1. Update `supabase/config.toml` with the provider configuration
2. Create an OAuth button component (similar to `GoogleLoginButton.tsx` or `DiscordLoginButton.tsx`)
3. Add the button to login/signup pages
4. Update environment variables
5. If the provider uses a different avatar field (not `avatar_url` or `picture`), update the database triggers and auth callback

See the [Supabase Auth documentation](https://supabase.com/docs/guides/auth/social-login) for provider-specific setup instructions.

## Security Considerations

- OAuth credentials are stored as environment variables (never committed to git)
- Supabase uses PKCE flow for enhanced security
- Session tokens are stored in httpOnly cookies
- Redirect URIs are validated against configured allowlist
