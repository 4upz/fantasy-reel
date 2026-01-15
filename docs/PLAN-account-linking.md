# Account Linking Plan for Fantasy Reel

## Problem Statement

There are two scenarios that need to be handled:

1. **Existing users want to link Discord** - A user who signed up with email/password wants to add Discord as an additional login method
2. **Discord sign-in with existing email** - A user tries to sign in with Discord, but an account with that email already exists

Currently, neither scenario is handled gracefully.

---

## Scenario Analysis

### Scenario 1: Existing User Wants to Link Discord

**Current behavior**: Not supported - no UI or functionality exists

**Desired behavior**:
- User goes to Settings page
- Sees "Connected Accounts" section showing linked providers
- Can click "Connect Discord" to link their Discord account
- After linking, can sign in with either email/password or Discord

**Supabase support**:
- `supabase.auth.linkIdentity({ provider: 'discord' })` - Links OAuth provider to current session
- `supabase.auth.unlinkIdentity(identity)` - Removes a linked identity
- `supabase.auth.getUserIdentities()` - Lists all linked identities

### Scenario 2: Discord Sign-in with Existing Email

**Current behavior**: Creates a NEW separate account (duplicate)

**Desired behavior options**:

| Option | Behavior | Pros | Cons |
|--------|----------|------|------|
| **A. Auto-link** | If email matches verified account, automatically link | Seamless UX | Could be security concern if OAuth email not verified |
| **B. Prompt to link** | Show message asking user to log in first, then link | Clear user control | Extra steps |
| **C. Block + redirect** | Prevent signup, redirect to login with message | Prevents duplicates | Could frustrate users |

**Recommendation**: Option B (Prompt to link) with Option A as enhancement for verified emails

---

## Implementation Plan

### Phase 1: Enable Manual Linking in Supabase

**Objective**: Allow identity linking at the Supabase level

**Tasks**:

1. **Update Supabase Config** (`supabase/config.toml`)
   ```toml
   [auth]
   enable_manual_linking = true
   ```

**Files Changed**:
- `supabase/config.toml`

---

### Phase 2: Connected Accounts UI in Settings

**Objective**: Show users their connected accounts and allow linking/unlinking

**Tasks**:

1. **Update Settings Page Server Component** (`apps/frontend/app/(authenticated)/settings/page.tsx`)
   - Fetch user identities using `supabase.auth.getUserIdentities()`
   - Pass identities to client component

2. **Create ConnectedAccounts Component** (`apps/frontend/app/(authenticated)/settings/components/ConnectedAccounts.tsx`)
   - Display list of connected providers (email, Discord, etc.)
   - Show connection status for each provider
   - "Connect Discord" button for unlinked providers
   - "Disconnect" button for linked OAuth providers (with safety check)

3. **Create Link/Unlink Server Actions** (`apps/frontend/app/(authenticated)/settings/actions.ts`)
   - Add `linkDiscordAccount()` action
   - Add `unlinkIdentity(identityId)` action
   - Validate user has at least one login method before unlinking

4. **Handle OAuth Linking Callback**
   - Update `/auth/callback/route.ts` to handle linking flow
   - Detect if this is a link operation vs. login operation
   - Redirect appropriately after linking

**New Files**:
- `apps/frontend/app/(authenticated)/settings/components/ConnectedAccounts.tsx`

**Modified Files**:
- `apps/frontend/app/(authenticated)/settings/page.tsx`
- `apps/frontend/app/(authenticated)/settings/SettingsClient.tsx`
- `apps/frontend/app/(authenticated)/settings/actions.ts`
- `apps/frontend/app/auth/callback/route.ts`

---

### Phase 3: Handle Duplicate Email Detection

**Objective**: Gracefully handle when OAuth email matches existing account

**Tasks**:

1. **Create Email Check Utility** (`apps/frontend/utils/auth/checkExistingEmail.ts`)
   - Function to check if email exists in system
   - Called during OAuth callback

2. **Update OAuth Callback** (`apps/frontend/app/auth/callback/route.ts`)
   - After OAuth, check if user was newly created or existing
   - If new user but email matches existing account:
     - This means Supabase created a duplicate (shouldn't happen with proper config)
     - Handle edge case gracefully

3. **Create Account Conflict Page** (`apps/frontend/app/auth/account-exists/page.tsx`)
   - Shown when OAuth email matches existing account
   - Explains the situation to user
   - Provides options:
     - "Sign in with email" button
     - "Sign in with email, then link Discord in settings"

4. **Pre-OAuth Email Check** (Optional enhancement)
   - Before redirecting to Discord, check if we can detect the email
   - Not always possible since we don't know Discord email until after OAuth

**New Files**:
- `apps/frontend/app/auth/account-exists/page.tsx`

**Modified Files**:
- `apps/frontend/app/auth/callback/route.ts`

---

### Phase 4: Automatic Linking for Verified Emails (Optional Enhancement)

**Objective**: Automatically link when safe to do so

**Tasks**:

1. **Configure Automatic Linking** (Supabase config)
   - Supabase can auto-link when:
     - OAuth provider returns verified email
     - Existing account email is confirmed
   - This requires careful configuration

2. **Email Verification Check**
   - Ensure existing users have confirmed emails before auto-linking
   - Discord always returns verified emails (Discord requires email verification)

**Note**: This phase is optional and should be carefully considered for security implications.

---

## Detailed Component Designs

### ConnectedAccounts Component

```tsx
// Visual structure
<section className="card p-6">
  <header>
    <LinkIcon />
    <h2>Connected Accounts</h2>
    <p>Manage your sign-in methods</p>
  </header>

  <div className="space-y-4">
    {/* Email/Password - Always shown */}
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Mail className="w-5 h-5" />
        <div>
          <p>Email & Password</p>
          <p className="text-sm text-muted">{email}</p>
        </div>
      </div>
      <Badge>Primary</Badge>
    </div>

    {/* Discord */}
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <DiscordIcon className="w-5 h-5" />
        <div>
          <p>Discord</p>
          {isLinked ? (
            <p className="text-sm text-muted">{discordUsername}</p>
          ) : (
            <p className="text-sm text-muted">Not connected</p>
          )}
        </div>
      </div>
      {isLinked ? (
        <Button variant="ghost" onClick={handleUnlink}>
          Disconnect
        </Button>
      ) : (
        <Button variant="outline" onClick={handleLink}>
          Connect
        </Button>
      )}
    </div>
  </div>
</section>
```

### Account Exists Page

```tsx
// Visual structure
<div className="max-w-md mx-auto text-center">
  <AlertCircle className="w-12 h-12 text-warning mx-auto" />
  <h1>Account Already Exists</h1>
  <p>
    An account with the email <strong>{email}</strong> already exists.
    To use Discord sign-in, please link it to your existing account.
  </p>

  <div className="space-y-3">
    <Link href="/login">
      <Button className="w-full">Sign in with Email</Button>
    </Link>
    <p className="text-sm text-muted">
      After signing in, go to Settings → Connected Accounts to link Discord
    </p>
  </div>
</div>
```

---

## Database Considerations

### Identity Storage

Supabase stores identities in `auth.identities` table:
- `id` - Identity ID
- `user_id` - Links to `auth.users`
- `provider` - e.g., "email", "discord"
- `identity_data` - Provider-specific data (username, avatar, etc.)

No additional migrations needed - Supabase handles this automatically.

### Profile Updates on Link

When Discord is linked to existing account:
- Should we update avatar_url if user doesn't have one?
- Should we offer to sync Discord avatar?

**Recommendation**: Don't auto-update, but offer option in UI.

---

## Security Considerations

1. **Unlink Protection**: Don't allow unlinking last identity (user would be locked out)
2. **Email Verification**: Only auto-link if both emails are verified
3. **Session Validation**: Ensure user is authenticated before linking
4. **CSRF Protection**: Supabase handles via state parameter

---

## User Flow Diagrams

### Flow 1: Existing User Links Discord

```
Settings Page
    ↓
Click "Connect Discord"
    ↓
Redirect to Discord OAuth
    ↓
User authorizes
    ↓
Callback to /auth/callback?linking=true
    ↓
Link identity to existing user
    ↓
Redirect to Settings with success message
```

### Flow 2: New User Signs Up with Discord (Email Exists)

```
Login/Signup Page
    ↓
Click "Continue with Discord"
    ↓
Redirect to Discord OAuth
    ↓
User authorizes
    ↓
Callback to /auth/callback
    ↓
Check: Is this a new user? Does email exist?
    ↓
If duplicate detected:
    → Redirect to /auth/account-exists
    → Show options to sign in with email
    ↓
If no duplicate:
    → Create profile, redirect to dashboard
```

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `apps/frontend/app/(authenticated)/settings/components/ConnectedAccounts.tsx` | Connected accounts management UI |
| `apps/frontend/app/auth/account-exists/page.tsx` | Account conflict resolution page |

### Modified Files
| File | Changes |
|------|---------|
| `supabase/config.toml` | Enable `enable_manual_linking = true` |
| `apps/frontend/app/(authenticated)/settings/page.tsx` | Fetch and pass user identities |
| `apps/frontend/app/(authenticated)/settings/SettingsClient.tsx` | Add ConnectedAccounts section |
| `apps/frontend/app/(authenticated)/settings/actions.ts` | Add link/unlink actions |
| `apps/frontend/app/auth/callback/route.ts` | Handle linking flow and duplicate detection |

---

## Testing Scenarios

1. **Link Discord to email account**
   - Sign up with email
   - Go to Settings → Connected Accounts
   - Click "Connect Discord"
   - Verify Discord appears as connected
   - Sign out, sign in with Discord
   - Verify same account/profile

2. **Unlink Discord**
   - With Discord linked, click "Disconnect"
   - Verify Discord shows as not connected
   - Verify can still sign in with email

3. **Prevent last identity unlink**
   - OAuth-only user tries to disconnect Discord
   - Should be prevented with error message

4. **Duplicate email handling**
   - Sign up with email
   - Sign out
   - Try "Continue with Discord" with same email
   - Should see account-exists page

5. **Fresh Discord signup**
   - New email, sign up with Discord
   - Should create account and profile successfully

---

## Success Criteria

- [ ] Users can see connected accounts in Settings
- [ ] Users can link Discord to existing email account
- [ ] Users can unlink Discord (if they have email/password)
- [ ] System prevents unlinking last login method
- [ ] Duplicate accounts are not created when emails match
- [ ] Clear messaging when account conflict detected
- [ ] Linked users can sign in with either method
