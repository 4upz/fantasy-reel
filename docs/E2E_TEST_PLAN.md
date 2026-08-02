# E2E Test Plan - Fantasy Reel

This document provides a complete test plan for E2E coverage of all critical user flows. Tests are organized by priority (P0-P3) and feature area.

---

## Test Priority Levels

| Priority | Definition | CI Gate? |
|----------|------------|----------|
| **P0** | Core user journeys - blocks release if failing | Yes |
| **P1** | Important features - should pass before release | Yes |
| **P2** | Secondary features - nice to have passing | Optional |
| **P3** | Edge cases and polish - catch regressions | No |

---

## Test File Organization

```
e2e/tests/
├── auth/                          # P0: Authentication flows
│   ├── signup.spec.ts             # Email signup + verification
│   ├── login.spec.ts              # Email login
│   ├── password-reset.spec.ts     # Forgot/reset password
│   ├── discord-oauth.spec.ts      # Discord OAuth flow
│   ├── google-oauth.spec.ts       # Google OAuth flow
│   └── account-linking.spec.ts    # Link/merge accounts
│
├── league/                        # P0-P1: League management
│   ├── create-league.spec.ts      # Create with config
│   ├── join-invitation.spec.ts    # Join via email invitation
│   ├── join-link.spec.ts          # Join via shareable link
│   ├── league-settings.spec.ts    # Owner settings management
│   └── invitations.spec.ts        # Send/resend/cancel invites
│
├── draft/                         # P0: Draft system
│   ├── draft-setup.spec.ts        # Pre-draft configuration
│   ├── draft-flow.spec.ts         # Single-user draft picks
│   ├── draft-realtime.spec.ts     # Multi-user real-time sync
│   ├── movie-picker.spec.ts       # Browse/search/filter movies
│   └── counterpick.spec.ts        # Counterpick rounds
│
├── bidding/                       # P1: Pickup bidding
│   ├── place-bid.spec.ts          # Place and view bids
│   ├── outbid-flow.spec.ts        # Counter-bidding
│   ├── cancel-bid.spec.ts         # Cancel active bids
│   └── bid-realtime.spec.ts       # Real-time bid updates
│
├── trading/                       # P1: Trading system
│   ├── propose-trade.spec.ts      # Create trade proposals
│   ├── respond-trade.spec.ts      # Accept/reject trades
│   ├── counter-trade.spec.ts      # Counter-offer flow
│   ├── cancel-trade.spec.ts       # Cancel pending trades
│   └── veto-trade.spec.ts         # Owner veto functionality
│
├── roster/                        # P2: Roster management
│   ├── view-roster.spec.ts        # View drafted movies
│   └── drop-movie.spec.ts         # Drop functionality
│
├── standings/                     # P1: Leaderboard
│   ├── view-standings.spec.ts     # View team rankings
│   ├── score-breakdown.spec.ts    # Movie score details
│   └── realtime-scores.spec.ts    # Live score updates
│
├── settings/                      # P2: User settings
│   ├── profile.spec.ts            # Update display name
│   ├── avatar.spec.ts             # Upload avatar
│   └── connected-accounts.spec.ts # OAuth account management
│
└── smoke/                         # P0: Critical path smoke tests
    └── critical-paths.spec.ts     # End-to-end user journeys
```

---

## P0: Critical Path Tests (Must Pass)

### 1. Authentication - `auth/`

#### `signup.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `complete signup with email verification` | Fill form → submit → verify email via Inbucket → confirm → login | - |
| `validation errors for invalid input` | Empty fields, weak password, invalid email | - |
| `duplicate email shows error` | Attempt signup with existing email | - |

#### `login.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `successful login redirects to dashboard` | Valid credentials → dashboard | - |
| `invalid credentials show error` | Wrong password shows error | - |
| `preserves return URL after login` | Protected page → login → redirect back | - |
| `Discord OAuth button visible` | OAuth option available | - |
| `Google OAuth button visible` | OAuth option available | - |

#### `password-reset.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `request password reset email` | Submit email → receive reset link | - |
| `reset password via email link` | Click link → enter new password → login | - |
| `invalid/expired token shows error` | Old token rejected | - |

#### `discord-oauth.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `first-time Discord login creates account` | OAuth flow → account created | - |
| `returning Discord login authenticates` | OAuth flow → existing account | - |

#### `google-oauth.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `first-time Google login creates account` | OAuth flow → account created | - |
| `returning Google login authenticates` | OAuth flow → existing account | - |

### 2. League Creation - `league/create-league.spec.ts`

| Test | Description | Edge Functions |
|------|-------------|----------------|
| `create league with defaults` | Name + team → creates league | `create-league` |
| `create league with custom config` | Advanced options → custom settings saved | `create-league` |
| `validates required fields` | Empty name rejected | `create-league` |
| `validates draft slots <= total slots` | Config validation | `create-league` |
| `owner redirected to draft page` | Success → `/league/[id]/draft` | - |

### 3. Join League - `league/join-invitation.spec.ts` & `league/join-link.spec.ts`

#### Via Email Invitation
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `join via invitation token` | `/join?token=X` → enter team name → joined | `join-league` |
| `invalid token shows error` | Bad token rejected | `join-league` |
| `expired invitation shows error` | Old invite rejected | `join-league` |
| `decline invitation` | Decline button → invitation declined | `decline-invitation` |

#### Via Shareable Link (New Feature)
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `join via join code` | `/join?code=X` → enter team name → joined | `join-league` |
| `invalid code shows error` | Bad code rejected | `join-league` |
| `join link disabled after draft starts` | Cannot join active league | `join-league` |

### 4. Draft Flow - `draft/`

#### `draft-setup.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `owner sees start draft button` | Button visible for owner | - |
| `non-owner sees waiting message` | "Waiting for draft to start" | - |
| `start draft changes status` | Click → status='drafting' | `start-draft` |

#### `draft-flow.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `make draft pick when your turn` | Select movie → pick → history updated | `draft-pick` |
| `cannot pick when not your turn` | Pick button disabled/hidden | `draft-pick` |
| `drafted movie removed from picker` | No duplicates | - |
| `draft progress updates` | Counter increments | - |

#### `draft-realtime.spec.ts` (Multi-User)
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `picks propagate to all users` | User A picks → User B sees immediately | `draft-pick` |
| `turn indicator updates in real-time` | Next user sees "Your turn" | - |
| `draft history syncs across clients` | All users see same history | - |

#### `movie-picker.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `browse movies loads results` | Initial load shows movies | `browse-movies` |
| `search filters movies` | Type query → filtered results | `search-movies` |
| `pagination loads more movies` | Scroll → load more | `browse-movies` |
| `favorite movies persists` | Add favorite → refresh → still there | - |

### 5. Smoke Tests - `smoke/critical-paths.spec.ts`

| Test | Description |
|------|-------------|
| `complete user journey: signup → create → draft → standings` | Full happy path |
| `invited user journey: join → bid → trade` | Invited user flow |

---

## P1: Important Feature Tests

### 1. Bidding - `bidding/`

#### `place-bid.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `place bid on undrafted movie` | Search → bid → success | `place-bid` |
| `budget decreases after bid` | Budget reflects active bids | - |
| `validation: bid exceeds budget` | Error shown | `place-bid` |
| `quick bid amounts work` | Click $25 → bid placed | `place-bid` |

#### `outbid-flow.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `higher bid outbids existing` | Team B > Team A → outbid status | `place-bid` |
| `outbid notification shown` | Original bidder notified | - |

#### `cancel-bid.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `cancel active bid` | Cancel → budget freed | `cancel-bid` |
| `cannot cancel processed bid` | Button disabled | `cancel-bid` |

#### `bid-realtime.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `bids appear in real-time` | Team A bids → Team B sees | - |

### 2. Trading - `trading/`

#### `propose-trade.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `propose trade with movies` | Select movies → propose → pending | `propose-trade` |
| `cannot trade released movies` | Released movies disabled | - |

#### `respond-trade.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `accept trade transfers movies` | Accept → movies swap | `respond-trade` |
| `reject trade keeps movies` | Reject → no transfer | `respond-trade` |

#### `counter-trade.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `counter-offer modifies trade` | Counter → new offer | `counter-trade` |
| `counter chain works` | Multiple counters | `counter-trade` |

#### `cancel-trade.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `cancel pending trade` | Cancel → status cancelled | `cancel-trade` |

#### `veto-trade.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `owner can veto trade` | Veto → movies unchanged | `veto-trade` |

### 3. Standings - `standings/`

#### `view-standings.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `shows team rankings` | Teams sorted by points | - |
| `shows movie counts` | Correct draft/pickup counts | - |

#### `score-breakdown.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `shows score sources` | IMDb, RT, Metacritic visible (RT drives scoring) | - |
| `shows fantasy points` | RT-based points with 90% Club accelerator | - |

### 4. League Settings - `league/league-settings.spec.ts`

| Test | Description | Edge Functions |
|------|-------------|----------------|
| `owner can update league name` | Edit → save → updated | `update-league` |
| `generate shareable join link` | Click → code generated | `generate-join-link` |
| `regenerate invalidates old link` | Regenerate → old code fails | `generate-join-link` |
| `non-owner cannot access settings` | Redirected or blocked | - |

### 5. Invitations - `league/invitations.spec.ts`

| Test | Description | Edge Functions |
|------|-------------|----------------|
| `send email invitation` | Enter email → send → email received | `send-invite` |
| `invite existing user by username` | Search → select → invite sent | `send-invite`, `search-users` |
| `resend invitation` | Click resend → new email | `resend-invitation` |
| `cancel invitation` | Cancel → token invalidated | `cancel-invitation` |

---

## P2: Secondary Feature Tests

### 1. Roster - `roster/`

#### `view-roster.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `shows drafted movies` | Draft picks visible | - |
| `shows pickup movies` | Bidding wins visible | - |
| `shows budget remaining` | FAAB budget correct | - |

#### `drop-movie.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `drop unreleased movie` | Drop → removed from roster | `drop-movie` |
| `cannot drop released movie` | Button disabled | `drop-movie` |
| `cannot exceed drop limit` | Error after limit reached | `drop-movie` |

### 2. User Settings - `settings/`

#### `profile.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `update display name` | Edit → save → updated | - |
| `character limit enforced` | Max 100 chars | - |

#### `avatar.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `upload avatar image` | Select file → uploaded | - |
| `invalid file type rejected` | Non-image rejected | - |

#### `connected-accounts.spec.ts`
| Test | Description | Edge Functions |
|------|-------------|----------------|
| `link Discord account` | Connect → Discord linked | - |
| `link Google account` | Connect → Google linked | - |
| `unlink with fallback auth` | Disconnect → success | - |
| `cannot unlink only auth method` | Error shown | - |

### 3. Counterpick - `draft/counterpick.spec.ts`

| Test | Description | Edge Functions |
|------|-------------|----------------|
| `start counterpick round` | Owner starts → status changes | `start-counterpick-round` |
| `make counterpick selection` | Select → submitted | `make-counterpick` |
| `counterpick order correct` | Reverse of draft order | - |

### 4. Account Linking - `auth/account-linking.spec.ts`

| Test | Description | Edge Functions |
|------|-------------|----------------|
| `merge OAuth with existing email` | Same email → merge prompt | `merge-accounts` |
| `link separate accounts` | Different identities combined | `merge-accounts` |

---

## P3: Edge Cases and Polish

### Error Handling

| Test | Area | Description |
|------|------|-------------|
| `network error during draft pick` | Draft | Retry mechanism works |
| `connection lost indicator` | Real-time | Shows reconnecting status |
| `race condition: double pick` | Draft | Only one pick accepted |
| `authorization: other team settings` | Security | Blocked appropriately |

### Validation

| Test | Area | Description |
|------|------|-------------|
| `budget boundary: exact amount` | Bidding | Bid at exactly remaining budget |
| `drop limit boundary` | Roster | Drop at exactly limit |
| `trade own movies only` | Trading | Cannot trade others' movies |

### Real-time Edge Cases

| Test | Area | Description |
|------|------|-------------|
| `reconnection syncs state` | All | After reconnect, data matches |
| `max reconnection attempts` | All | Shows permanent error after 3 |
| `concurrent modifications` | Trading | Handles simultaneous actions |

---

## Test Data Requirements

### Mock Data Constants (`fixtures/test-data.ts`)

```typescript
// Movies for draft/bidding tests
MOCK_MOVIES: TMDbSearchResult[] // 10+ movies with varying scores

// Users for multi-user tests
TEST_USERS: {
  primary: TestUser
  secondary: TestUser
  owner: TestUser
}

// League configurations
LEAGUE_CONFIGS: {
  default: LeagueConfig
  customDraft: LeagueConfig
  withBidding: LeagueConfig
  withTrading: LeagueConfig
}
```

### Database Seeding (`global-setup.ts`)

1. Clean stale test data (emails ending `@test.local`)
2. Seed mock movies with known TMDb IDs
3. Seed test reviews for score calculation tests

---

## CI/CD Test Groups

### Pre-merge (Every PR)
```bash
npx playwright test --grep @critical --project=chromium
```
- All P0 tests
- Single browser (Chromium)
- ~5 min timeout

### Nightly Full Suite
```bash
npx playwright test
```
- All P0, P1, P2 tests
- All browsers (Chromium, Firefox, WebKit)
- Mobile viewport
- ~30 min timeout

### Release Gate
```bash
npx playwright test --grep "@critical|@important"
```
- P0 + P1 tests
- Desktop + mobile
- Must pass 100%

---

## Test Tags

Use tags to categorize and filter tests:

```typescript
test('complete signup flow @critical @auth', ...)
test('draft pick propagates @critical @realtime @draft', ...)
test('outbid notification @important @bidding', ...)
test('avatar upload @secondary @settings', ...)
```

### Available Tags
- `@critical` - P0 tests
- `@important` - P1 tests
- `@secondary` - P2 tests
- `@realtime` - Tests real-time subscriptions
- `@multiuser` - Requires multiple browser contexts
- `@auth` - Authentication tests
- `@draft` - Draft system tests
- `@bidding` - Bidding tests
- `@trading` - Trading tests
- `@oauth` - OAuth provider tests

---

## Estimated Coverage

| Area | Tests | Priority | Status |
|------|-------|----------|--------|
| Authentication | 15 | P0 | Sample created |
| League Creation | 5 | P0 | Sample created |
| Join League | 8 | P0 | Planned |
| Draft Flow | 12 | P0 | Sample created |
| Bidding | 8 | P1 | Planned |
| Trading | 10 | P1 | Planned |
| Standings | 5 | P1 | Planned |
| Roster | 4 | P2 | Planned |
| User Settings | 6 | P2 | Planned |
| Smoke Tests | 3 | P0 | Planned |
| **Total** | **76** | - | - |

---

## Next Steps

1. **Immediate**: Add `data-testid` attributes to all components (see Appendix)
2. **Week 1**: Complete P0 test implementation
3. **Week 2**: Complete P1 test implementation
4. **Week 3**: CI/CD integration and optimization
5. **Ongoing**: Add P2/P3 tests as features stabilize

---

## Appendix: Required data-testid Additions

See `docs/E2E_TESTING_STRATEGY.md` for complete list of required `data-testid` attributes by component.
