# Shareable Join Links

Design for allowing league owners to generate reusable join links that multiple users can use to join a league.

## Problem

Current invitation system is email-specific and single-use. League owners want to share a single link (e.g., in a group chat or Discord) that anyone can use to join.

## Solution

Add shareable join links with:
- **Short code** (e.g., `XK7M2P`) for manual entry or verbal sharing
- **Full URL** for click-to-join convenience
- **Single active link** per league - regenerating invalidates the old one

---

## Data Model

Add two columns to the `leagues` table:

```sql
ALTER TABLE leagues ADD COLUMN join_code VARCHAR(8) UNIQUE;
ALTER TABLE leagues ADD COLUMN join_token UUID UNIQUE;
```

| Column | Type | Description |
|--------|------|-------------|
| `join_code` | VARCHAR(8) | Short alphanumeric code (e.g., `XK7M2P`) |
| `join_token` | UUID | Full token for URL-based joining |

- Both `NULL` by default (no shareable link until generated)
- Both replaced on regeneration (invalidates old links)
- `UNIQUE` constraints prevent collisions

**Code format:** 6 uppercase alphanumeric characters, excluding ambiguous chars (O, 0, I, 1, L).

**RLS:** Join code/token visible to league owner only, not all participants.

---

## API

### New: `generate-join-link`

Generates (or regenerates) a shareable join link for a league.

**Request:**
```json
{ "league_id": "uuid" }
```

**Auth:** League owner only

**Logic:**
1. Verify user is league owner
2. Verify league status is `setup`
3. Generate new 6-char `join_code` and UUID `join_token`
4. Update league (replaces existing values)
5. Return code and full URL

**Response:**
```json
{
  "join_code": "XK7M2P",
  "join_url": "https://fantasyreel.com/join?code=XK7M2P",
  "join_token": "abc123..."
}
```

**Errors:**
| Status | Message |
|--------|---------|
| 401 | Unauthorized |
| 403 | Only the league owner can generate join links |
| 400 | Cannot generate join link after draft has started |
| 404 | League not found |

### Modified: `join-league`

Add support for joining via `join_code` or `join_token`.

**Request options:**
```json
{ "invitation_token": "uuid" }        // Existing: email invitation
{ "league_id": "uuid" }               // Existing: direct join (non-invite-only)
{ "join_code": "XK7M2P" }             // New: shareable code
{ "join_token": "uuid" }              // New: shareable token
```

**Logic changes:**
- Look up league by `join_code` or `join_token` column
- Skip email validation (shareable links aren't tied to specific users)
- All other validation unchanged (league status, capacity, duplicate membership)

**New errors:**
| Status | Message |
|--------|---------|
| 400 | Invalid join code |
| 404 | Invalid join code (code doesn't match any league) |

---

## Frontend

### New Component: `JoinLinkSection`

Displays in League Settings (always) and Dashboard (during setup phase).

**States:**

1. **No link generated:**
```
┌─────────────────────────────────────────────────────────┐
│ 🔗 Shareable Join Link                                  │
│ Anyone with this link can join your league              │
├─────────────────────────────────────────────────────────┤
│ [No join link generated yet]                            │
│ [ Generate Join Link ]                                  │
└─────────────────────────────────────────────────────────┘
```

2. **Link generated:**
```
┌─────────────────────────────────────────────────────────┐
│ 🔗 Shareable Join Link                                  │
│ Anyone with this link can join your league              │
├─────────────────────────────────────────────────────────┤
│ Join Code: XK7M2P                            [ Copy ]   │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ https://fantasyreel.com/join?code=XK7M2P    [ Copy ]│ │
│ └─────────────────────────────────────────────────────┘ │
│ [ Regenerate ]                                          │
└─────────────────────────────────────────────────────────┘
```

3. **Locked (after draft starts):**
- Show existing code as read-only
- Hide Generate/Regenerate buttons

**Regenerate confirmation:** Modal warning that old links will stop working.

### Modified: `/join` Page

| Query Param | Behavior |
|-------------|----------|
| `?token=<uuid>` | Existing invitation flow |
| `?code=<code>` | New shareable link flow |
| Neither | Show manual code entry form |

**Manual entry form:**
```
┌─────────────────────────────────────────────────────────┐
│              Join a League                              │
│   Enter the join code shared by your league owner       │
│   ┌───────────────────────────────────────────────┐     │
│   │  [______]                                     │     │
│   └───────────────────────────────────────────────┘     │
│              [ Join League ]                            │
└─────────────────────────────────────────────────────────┘
```

**Auth:** If not logged in, redirect to `/login?returnUrl=/join?code=...`

---

## Implementation Plan

### Phase 1: Database
1. Create migration adding `join_code` and `join_token` columns to `leagues`
2. Add unique indexes
3. Update RLS policies (owner-only visibility for these columns)

### Phase 2: Backend
1. Create `generate-join-link` edge function
2. Modify `join-league` to accept `join_code` and `join_token`
3. Add tests for both functions

### Phase 3: Frontend
1. Create `JoinLinkSection` component
2. Add to Settings page (new section)
3. Add to Dashboard (conditional on setup phase)
4. Update `/join` page to handle `?code=` param and manual entry

---

## Security Considerations

- Join codes are short but not enumerable (random generation)
- Rate limiting on join attempts recommended (future enhancement)
- Regeneration provides revocation if link spreads too widely
- Service role client used for join (user not participant yet) - same as invitations
- League natural limits apply (max participants, setup status only)

---

## Future Enhancements (Not in Scope)

- Optional usage limits per link
- Optional expiration dates
- Multiple active links per league
- Analytics (how many joined via link vs invitation)
