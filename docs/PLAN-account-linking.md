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

**The challenge**: When a user clicks "Continue with Discord", Supabase completes the OAuth flow before we can intervene. By the time our callback is reached, Supabase has either:
- Created a duplicate account (default behavior)
- Auto-linked if both emails are verified (with proper config)

**Desired behavior options**:

| Option | Behavior | Pros | Cons |
|--------|----------|------|------|
| **A. Auto-link** | If email matches verified account, automatically link | Seamless UX | Requires both emails verified |
| **B. Inline password verification** | Prompt for existing account password, then merge | Keeps user in flow, immediate resolution | Requires password entry |
| **C. Email verification link** | Send link to verify ownership, then merge | No password needed | Slower, user leaves flow |
| **D. Redirect to login** | Tell user to sign in with email first | Simple | Poor UX, manual steps |

**Recommendation**: Option B (Inline password verification) as primary, with Option A enabled for verified emails

**Inline Verification Flow**:
1. User clicks "Continue with Discord"
2. Discord OAuth completes
3. Callback detects: new user created, but email matches existing account
4. Redirect to `/auth/link-account` page showing:
   - "An account with this email already exists"
   - Password field to verify ownership of existing account
   - "Link Accounts" button
5. On submit: verify password against original account
6. If valid: link Discord identity to original account, delete duplicate, sign in
7. User lands on dashboard with Discord now linked

This keeps the user in the authentication flow and resolves the conflict immediately.

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

### Phase 3: Handle Duplicate Email with Inline Linking

**Objective**: When OAuth creates a duplicate account, let user verify ownership and merge accounts inline

**Tasks**:

1. **Update OAuth Callback** (`apps/frontend/app/auth/callback/route.ts`)
   - After OAuth, detect if this is a duplicate scenario:
     - Check if user was just created (`created_at` is recent)
     - Check if another user exists with same email
   - If duplicate detected:
     - Store duplicate user info in secure cookie/session
     - Redirect to `/auth/link-account` with necessary params
   - If no duplicate: proceed normally

2. **Create Link Account Page** (`apps/frontend/app/auth/link-account/page.tsx`)
   - Server component that reads duplicate context from cookie/params
   - Displays:
     - Clear explanation of the situation
     - The email address in question
     - Password input for existing account
     - "Link Accounts" submit button
     - "Keep Separate Accounts" option (edge case)
   - Styled consistently with login/signup pages

3. **Create Link Account Client Component** (`apps/frontend/app/auth/link-account/LinkAccountClient.tsx`)
   - Handles form submission
   - Shows loading state during verification
   - Displays errors (wrong password, etc.)

4. **Create Merge Accounts Server Action** (`apps/frontend/app/auth/link-account/actions.ts`)
   - `verifyAndMergeAccounts(password, duplicateUserId, originalEmail)`:
     1. Verify password against original account using `signInWithPassword`
     2. If valid:
        - Get Discord identity from duplicate account
        - Link Discord identity to original account (admin API or direct DB)
        - Delete duplicate account and its profile
        - Create session for original account
        - Return success
     3. If invalid: return error

5. **Create Supabase Edge Function** (`supabase/functions/merge-accounts/index.ts`)
   - Handles the account merge operation server-side
   - Required because linking identities across users needs admin privileges
   - Accepts: `originalUserId`, `duplicateUserId`, `identityToMove`
   - Performs:
     - Move identity from duplicate to original user
     - Delete duplicate user's profile
     - Delete duplicate user from auth.users
   - Returns success/failure

**New Files**:
- `apps/frontend/app/auth/link-account/page.tsx`
- `apps/frontend/app/auth/link-account/LinkAccountClient.tsx`
- `apps/frontend/app/auth/link-account/actions.ts`
- `supabase/functions/merge-accounts/index.ts`

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

### Link Account Page (Inline Merge Flow)

```tsx
// Visual structure - /auth/link-account
<div className="max-w-md mx-auto">
  <div className="text-center mb-8">
    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gold-muted flex items-center justify-center">
      <Link2 className="w-8 h-8 text-gold" />
    </div>
    <h1 className="text-2xl font-display font-bold">Link Your Accounts</h1>
    <p className="text-foreground-secondary mt-2">
      An account with <strong>{email}</strong> already exists.
      Enter your password to link Discord to your existing account.
    </p>
  </div>

  <form onSubmit={handleMerge} className="space-y-6">
    {/* Discord info being linked */}
    <div className="p-4 bg-surface rounded-lg border border-border">
      <div className="flex items-center gap-3">
        <DiscordIcon className="w-8 h-8 text-[#5865F2]" />
        <div>
          <p className="font-medium">{discordUsername}</p>
          <p className="text-sm text-foreground-muted">Discord account to link</p>
        </div>
      </div>
    </div>

    {/* Password verification */}
    <div>
      <label className="block text-sm font-medium mb-2">
        Enter password for {email}
      </label>
      <input
        type="password"
        placeholder="Your existing account password"
        className="input"
        required
      />
    </div>

    {error && <FormError message={error} />}

    <button type="submit" className="btn btn-primary w-full">
      {isLoading ? 'Linking...' : 'Link Accounts'}
    </button>
  </form>

  {/* Alternative option */}
  <div className="mt-6 pt-6 border-t border-border text-center">
    <p className="text-sm text-foreground-muted mb-3">
      Don't want to link accounts?
    </p>
    <button onClick={handleKeepSeparate} className="btn btn-ghost text-sm">
      Keep as Separate Account
    </button>
  </div>
</div>
```

**States to handle**:
- Loading during password verification
- Error: incorrect password
- Error: merge operation failed
- Success: redirect to dashboard with toast

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
Check: Is this a new user? Does email match existing account?
    ↓
If duplicate detected:
    → Store duplicate context (userId, email, discordUsername)
    → Redirect to /auth/link-account
    ↓
/auth/link-account page:
    → Show Discord account being linked
    → Prompt for existing account password
    → User enters password
    ↓
On submit:
    → Verify password against original account
    → If valid: Call merge-accounts edge function
        → Link Discord identity to original account
        → Delete duplicate account
        → Sign in as original user
        → Redirect to dashboard with success toast
    → If invalid: Show error, allow retry
    ↓
Alternative: "Keep Separate Account"
    → Continue with duplicate account as-is
    → Redirect to dashboard
```

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `apps/frontend/app/(authenticated)/settings/components/ConnectedAccounts.tsx` | Connected accounts management UI |
| `apps/frontend/app/auth/link-account/page.tsx` | Inline account linking page |
| `apps/frontend/app/auth/link-account/LinkAccountClient.tsx` | Client component for link form |
| `apps/frontend/app/auth/link-account/actions.ts` | Server actions for merge flow |
| `supabase/functions/merge-accounts/index.ts` | Edge function to merge accounts (admin operation) |

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

1. **Link Discord to email account (from Settings)**
   - Sign up with email
   - Go to Settings → Connected Accounts
   - Click "Connect Discord"
   - Authorize in Discord
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

4. **Duplicate email - successful merge**
   - Sign up with email, set a password
   - Sign out
   - Click "Continue with Discord" (same email)
   - Should redirect to /auth/link-account
   - Enter correct password
   - Should merge accounts and redirect to dashboard
   - Verify Discord is now linked in Settings
   - Sign out, sign in with either method works

5. **Duplicate email - wrong password**
   - Sign up with email
   - Sign out
   - Click "Continue with Discord" (same email)
   - Enter wrong password
   - Should show error, allow retry

6. **Duplicate email - keep separate**
   - Sign up with email
   - Sign out
   - Click "Continue with Discord" (same email)
   - Click "Keep as Separate Account"
   - Should continue with new account
   - Now have two accounts with same email (edge case)

7. **Fresh Discord signup**
   - New email (no existing account)
   - Click "Continue with Discord"
   - Should create account and profile successfully
   - No link-account page shown

---

## Success Criteria

- [ ] Users can see connected accounts in Settings
- [ ] Users can link Discord to existing email account (from Settings)
- [ ] Users can unlink Discord (if they have email/password)
- [ ] System prevents unlinking last login method
- [ ] When OAuth email matches existing account, user sees inline linking flow
- [ ] User can verify ownership with password and merge accounts
- [ ] Merged accounts have Discord identity linked correctly
- [ ] Duplicate account is cleaned up after successful merge
- [ ] User can opt to keep separate accounts if desired
- [ ] Linked users can sign in with either email or Discord
