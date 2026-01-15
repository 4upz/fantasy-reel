# Discord OAuth Implementation Plan for Fantasy Reel

## Overview

This plan outlines the implementation of Discord OAuth authentication for Fantasy Reel, leveraging Supabase's built-in OAuth provider support. Supabase natively supports Discord as an identity provider, making this the most efficient and maintainable approach.

---

## Current State

- **Authentication**: Email/password only via Supabase Auth
- **Email Confirmation**: Required before login (`enable_confirmations = true`)
- **Profile System**: `profiles` table with `display_name` and `avatar_url`
- **OAuth Infrastructure**: Supabase config has provider stubs (all disabled)
- **No existing OAuth**: `signInWithOAuth()` not used anywhere in codebase

---

## Implementation Phases

### Phase 1: Discord Developer Setup

**Objective**: Create Discord OAuth application and obtain credentials

**Tasks**:

1. **Create Discord Application**
   - Navigate to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create new application named "Fantasy Reel"
   - Navigate to OAuth2 section

2. **Configure OAuth2 Settings**
   - Add redirect URIs:
     - Local: `http://localhost:54321/auth/v1/callback`
     - Production: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Note the Client ID and Client Secret

3. **Set OAuth Scopes**
   - `identify` - Access user's ID, username, avatar
   - `email` - Access user's email address

**Files Changed**: None (external configuration)

---

### Phase 2: Supabase Configuration

**Objective**: Enable Discord provider in Supabase

**Tasks**:

1. **Update Local Config** (`supabase/config.toml`)
   ```toml
   [auth.external.discord]
   enabled = true
   client_id = "env(DISCORD_CLIENT_ID)"
   secret = "env(DISCORD_CLIENT_SECRET)"
   redirect_uri = ""  # Uses default Supabase callback
   ```

2. **Environment Variables**
   - Add to `.env.local`:
     ```
     DISCORD_CLIENT_ID=your_client_id
     DISCORD_CLIENT_SECRET=your_client_secret
     ```

3. **Production Configuration**
   - Configure via Supabase Dashboard > Authentication > Providers > Discord
   - Add Client ID and Secret from Discord Developer Portal

**Files Changed**:
- `supabase/config.toml`
- `.env.local` (create/update)
- `.env.example` (update with new variables)

---

### Phase 3: Auth Callback Route

**Objective**: Handle OAuth callback from Supabase

**Tasks**:

1. **Create OAuth Callback Route** (`apps/frontend/app/auth/callback/route.ts`)
   ```typescript
   import { createClient } from '@/utils/supabase/server'
   import { NextResponse } from 'next/server'

   export async function GET(request: Request) {
     const { searchParams, origin } = new URL(request.url)
     const code = searchParams.get('code')
     const next = searchParams.get('next') ?? '/dashboard'

     if (code) {
       const supabase = await createClient()
       const { error } = await supabase.auth.exchangeCodeForSession(code)

       if (!error) {
         // Check if profile exists, create if not
         const { data: { user } } = await supabase.auth.getUser()
         if (user) {
           const { data: profile } = await supabase
             .from('profiles')
             .select('id')
             .eq('id', user.id)
             .single()

           if (!profile) {
             // Create profile from Discord data
             await supabase.from('profiles').insert({
               id: user.id,
               display_name: user.user_metadata.full_name ||
                            user.user_metadata.name ||
                            user.email?.split('@')[0],
               avatar_url: user.user_metadata.avatar_url
             })
           }
         }

         return NextResponse.redirect(`${origin}${next}`)
       }
     }

     return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
   }
   ```

2. **Update Existing Confirm Route**
   - Ensure `app/auth/confirm/route.ts` doesn't conflict with OAuth flow

**Files Changed**:
- `apps/frontend/app/auth/callback/route.ts` (new)

---

### Phase 4: Login/Signup UI Updates

**Objective**: Add Discord login button to authentication pages

**Tasks**:

1. **Create OAuth Button Component** (`apps/frontend/components/auth/discord-login-button.tsx`)
   ```typescript
   'use client'

   import { createClient } from '@/utils/supabase/client'
   import { Button } from '@/components/ui/button'

   export function DiscordLoginButton() {
     const handleDiscordLogin = async () => {
       const supabase = createClient()
       await supabase.auth.signInWithOAuth({
         provider: 'discord',
         options: {
           redirectTo: `${window.location.origin}/auth/callback`,
           scopes: 'identify email'
         }
       })
     }

     return (
       <Button
         onClick={handleDiscordLogin}
         variant="outline"
         className="w-full"
       >
         <DiscordIcon className="mr-2 h-4 w-4" />
         Continue with Discord
       </Button>
     )
   }
   ```

2. **Create Discord Icon Component** (`apps/frontend/components/icons/discord.tsx`)
   - SVG icon for Discord branding

3. **Update Login Page** (`apps/frontend/app/(public)/login/page.tsx`)
   - Add divider with "or"
   - Add Discord login button below email/password form

4. **Update Signup Page** (`apps/frontend/app/(public)/signup/page.tsx`)
   - Add same Discord button component
   - Consider whether to show signup form at all for OAuth users

**Files Changed**:
- `apps/frontend/components/auth/discord-login-button.tsx` (new)
- `apps/frontend/components/icons/discord.tsx` (new)
- `apps/frontend/app/(public)/login/page.tsx`
- `apps/frontend/app/(public)/signup/page.tsx`

---

### Phase 5: Profile Handling for OAuth Users

**Objective**: Ensure OAuth users have proper profiles and handle avatar sync

**Tasks**:

1. **Database Trigger for Profile Creation** (`supabase/migrations/YYYYMMDD_oauth_profile_trigger.sql`)
   ```sql
   -- Create or update profile on OAuth login
   CREATE OR REPLACE FUNCTION public.handle_oauth_user()
   RETURNS TRIGGER AS $$
   BEGIN
     INSERT INTO public.profiles (id, display_name, avatar_url)
     VALUES (
       NEW.id,
       COALESCE(
         NEW.raw_user_meta_data->>'full_name',
         NEW.raw_user_meta_data->>'name',
         split_part(NEW.email, '@', 1)
       ),
       NEW.raw_user_meta_data->>'avatar_url'
     )
     ON CONFLICT (id) DO UPDATE SET
       avatar_url = COALESCE(
         EXCLUDED.avatar_url,
         profiles.avatar_url
       ),
       updated_at = NOW();
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   -- Trigger on auth.users insert/update
   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
   CREATE TRIGGER on_auth_user_created
     AFTER INSERT ON auth.users
     FOR EACH ROW
     EXECUTE FUNCTION public.handle_oauth_user();
   ```

2. **Avatar URL Handling**
   - Discord avatars are external URLs
   - Current system uses Supabase Storage
   - Option A: Store Discord avatar URL directly (simpler)
   - Option B: Download and re-upload to Supabase Storage (more control)
   - **Recommendation**: Option A initially, with future migration path

3. **Update Profile Display**
   - Ensure avatar component handles both external URLs and storage paths
   - Update `apps/frontend/components/user-avatar.tsx` if needed

**Files Changed**:
- `supabase/migrations/YYYYMMDD_oauth_profile_trigger.sql` (new)
- `apps/frontend/components/user-avatar.tsx` (if exists, update)

---

### Phase 6: Account Linking Considerations

**Objective**: Handle users who have both email and Discord accounts

**Tasks**:

1. **Enable Manual Linking** (optional, for future)
   ```toml
   [auth]
   enable_manual_linking = true
   ```

2. **Link Detection Strategy**
   - If user signs in with Discord and email already exists:
     - Supabase default: Creates separate account
     - With linking: Can merge accounts
   - **Recommendation**: Start with default behavior, add linking later if users request

3. **Settings Page Update** (`apps/frontend/app/(authenticated)/settings/page.tsx`)
   - Show connected providers
   - Add "Connect Discord" option for email users (future enhancement)

**Files Changed** (optional/future):
- `supabase/config.toml`
- `apps/frontend/app/(authenticated)/settings/page.tsx`

---

### Phase 7: Testing & Documentation

**Objective**: Ensure OAuth flow works correctly and document setup

**Tasks**:

1. **Local Testing**
   - Test full OAuth flow with local Supabase
   - Verify profile creation
   - Test edge cases (existing email, etc.)

2. **Update Documentation**
   - Add Discord OAuth setup to `docs/SETUP.md` or create `docs/OAUTH.md`
   - Document environment variables needed
   - Add troubleshooting section

3. **Update Seed Data** (optional)
   - Add test user with Discord provider for development

**Files Changed**:
- `docs/OAUTH.md` (new) or update `docs/SETUP.md`
- `supabase/seed.sql` (optional)

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `apps/frontend/app/auth/callback/route.ts` | OAuth callback handler |
| `apps/frontend/components/auth/discord-login-button.tsx` | Discord login button |
| `apps/frontend/components/icons/discord.tsx` | Discord SVG icon |
| `supabase/migrations/YYYYMMDD_oauth_profile_trigger.sql` | Profile auto-creation |
| `docs/OAUTH.md` | OAuth setup documentation |

### Modified Files
| File | Changes |
|------|---------|
| `supabase/config.toml` | Enable Discord provider |
| `.env.example` | Add Discord credentials |
| `apps/frontend/app/(public)/login/page.tsx` | Add Discord button |
| `apps/frontend/app/(public)/signup/page.tsx` | Add Discord button |

---

## Environment Variables

```bash
# Discord OAuth (required)
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret

# Existing (no changes needed)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## Security Considerations

1. **PKCE Flow**: Supabase uses PKCE by default for OAuth, providing additional security
2. **Redirect URI Validation**: Only allow configured redirect URIs in Discord app
3. **Token Storage**: Supabase handles session tokens securely in httpOnly cookies
4. **Scope Minimization**: Only request `identify` and `email` scopes
5. **CSRF Protection**: Supabase includes state parameter validation

---

## Future Enhancements

1. **Additional Providers**: Google, GitHub, Twitch (all supported by Supabase)
2. **Account Linking**: Allow users to connect multiple providers
3. **Discord Integration**:
   - Show Discord username in league chat
   - Discord bot for draft notifications
   - League Discord server integration
4. **Avatar Sync**: Option to sync avatar from Discord periodically

---

## Rollback Plan

If issues arise:
1. Set `enabled = false` in `supabase/config.toml` for Discord provider
2. Remove Discord button from login/signup pages
3. Existing email/password users unaffected
4. OAuth users can use "Forgot Password" to set password and continue

---

## Success Criteria

- [ ] Users can click "Continue with Discord" on login/signup pages
- [ ] Discord OAuth flow redirects to Discord, then back to app
- [ ] New OAuth users have profile automatically created
- [ ] OAuth users land on dashboard after authentication
- [ ] Existing email users can still log in normally
- [ ] Avatar from Discord appears in user profile
