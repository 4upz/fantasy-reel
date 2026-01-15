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
   - For local development: `http://localhost:54321/auth/v1/callback`
   - For production: `https://<your-project-ref>.supabase.co/auth/v1/callback`

   > Note: The redirect URI uses Supabase's auth endpoint, not your frontend URL

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

### Profile Data from Discord

When a user signs in with Discord, the following data is used:

| Discord Field | Fantasy Reel Field |
|--------------|-------------------|
| `global_name` or `username` | `display_name` |
| `avatar` URL | `avatar_url` |
| `email` | Used for account identification |

### Database Trigger

The `handle_new_user()` trigger automatically creates profiles for new users:

- For email signup: Uses the `display_name` from signup form
- For OAuth: Extracts `global_name`, `full_name`, or `name` from provider metadata
- Avatar URL is synced from OAuth provider if available

## Troubleshooting

### "Invalid redirect URI" Error

Ensure your redirect URI in Discord Developer Portal exactly matches:
- Local: `http://localhost:54321/auth/v1/callback`
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

Supabase supports many OAuth providers. To add another:

1. Update `supabase/config.toml`:
   ```toml
   [auth.external.google]
   enabled = true
   client_id = "env(GOOGLE_CLIENT_ID)"
   secret = "env(GOOGLE_CLIENT_SECRET)"
   ```

2. Create the OAuth button component (similar to `DiscordLoginButton.tsx`)

3. Add the button to login/signup pages

4. Update environment variables

Supported providers include: Google, GitHub, GitLab, Apple, Azure, Twitch, and more.

## Security Considerations

- OAuth credentials are stored as environment variables (never committed to git)
- Supabase uses PKCE flow for enhanced security
- Session tokens are stored in httpOnly cookies
- Redirect URIs are validated against configured allowlist
