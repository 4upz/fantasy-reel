# Shareable Join Links Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow league owners to generate reusable join links that multiple users can use to join a league.

**Architecture:** Add `join_code` and `join_token` columns to the `leagues` table. Create a new `generate-join-link` Edge Function. Modify `join-league` to accept join codes. Add UI components to Settings and Dashboard pages.

**Tech Stack:** Supabase PostgreSQL, Deno Edge Functions, Next.js 15, React 19, Tailwind CSS 4

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260206_add_shareable_join_links.sql`

**Step 1: Create the migration file**

```sql
-- Add shareable join link columns to leagues table
-- join_code: 6-character alphanumeric code for manual entry
-- join_token: UUID for URL-based joining

ALTER TABLE leagues ADD COLUMN join_code VARCHAR(8) UNIQUE;
ALTER TABLE leagues ADD COLUMN join_token UUID UNIQUE;

-- Index for fast lookups
CREATE INDEX idx_leagues_join_code ON leagues(join_code) WHERE join_code IS NOT NULL;
CREATE INDEX idx_leagues_join_token ON leagues(join_token) WHERE join_token IS NOT NULL;

-- RLS: Only league owners can see join_code/join_token
-- Note: These columns are already covered by the existing leagues SELECT policy
-- which allows owners and participants to view league data.
-- However, we want ONLY owners to see join codes, so we need a helper function.

-- Helper function to check if user is league owner (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION is_league_owner_for_join_code(league_row leagues)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT league_row.owner_id = (SELECT auth.uid())
$$;

COMMENT ON COLUMN leagues.join_code IS 'Shareable 6-char code for joining league. Only visible to owner.';
COMMENT ON COLUMN leagues.join_token IS 'UUID token for shareable join URL. Only visible to owner.';
```

**Step 2: Apply the migration**

Run: `cd /Users/ariksmith/Dev/projects/fantasy-reel/.worktrees/shareable-join-links && npx supabase migration up`

Expected: Migration applied successfully

**Step 3: Verify the schema**

Run: `cd /Users/ariksmith/Dev/projects/fantasy-reel/.worktrees/shareable-join-links && npx supabase db diff`

Expected: No diff (schema matches migrations)

**Step 4: Commit**

```bash
git add supabase/migrations/20260206_add_shareable_join_links.sql
git commit -m "feat(db): add join_code and join_token columns to leagues"
```

---

## Task 2: Shared Utility - Join Code Generation

**Files:**
- Modify: `supabase/functions/_shared/utils.ts`
- Create: `supabase/functions/_shared/utils.test.ts` (add tests)

**Step 1: Add the join code generation function to utils.ts**

Add at the end of `supabase/functions/_shared/utils.ts`:

```typescript
// Characters for join codes - excludes ambiguous chars (0, O, I, 1, L)
const JOIN_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateJoinCode(length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)]
  }
  return code
}

const JOIN_CODE_REGEX = /^[A-HJ-NP-Z2-9]{6}$/

export function isValidJoinCode(code: string): boolean {
  return Boolean(code) && JOIN_CODE_REGEX.test(code.toUpperCase())
}
```

**Step 2: Run existing tests to ensure no regression**

Run: `npm run test:functions 2>&1 | grep -E "(PASS|FAIL|passed|failed)"`

Expected: Tests pass (existing 20 passed, 2 pre-existing failures in trade tests)

**Step 3: Commit**

```bash
git add supabase/functions/_shared/utils.ts
git commit -m "feat(utils): add generateJoinCode and isValidJoinCode helpers"
```

---

## Task 3: Edge Function - generate-join-link

**Files:**
- Create: `supabase/functions/generate-join-link/index.ts`
- Create: `supabase/functions/tests/generate-join-link.test.ts`

**Step 3.1: Write the test file first**

Create `supabase/functions/tests/generate-join-link.test.ts`:

```typescript
import { describe, it } from 'jsr:@std/testing/bdd'
import { expect } from 'jsr:@std/expect'
import { createTestClient, createTestUser, cleanupTestData } from './_setup.ts'

describe('generate-join-link', () => {
  const testIds: string[] = []

  it('returns 401 when not authenticated', async () => {
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league_id: '00000000-0000-0000-0000-000000000001' }),
      }
    )
    expect(response.status).toBe(401)
  })

  it('returns 400 for missing league_id', async () => {
    const { client, user } = await createTestUser()
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({}),
      }
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('league_id')
  })

  it('returns 404 for non-existent league', async () => {
    const { client } = await createTestUser()
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ league_id: '00000000-0000-0000-0000-000000000001' }),
      }
    )
    expect(response.status).toBe(404)
  })

  it('returns 403 when user is not the league owner', async () => {
    const { client: ownerClient, user: owner } = await createTestUser()
    const { client: memberClient, user: member } = await createTestUser()

    // Create league as owner
    const createResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await ownerClient.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ name: 'Test League', max_participants: 8 }),
      }
    )
    const { league } = await createResponse.json()
    testIds.push(league.id)

    // Try to generate link as non-owner
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await memberClient.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ league_id: league.id }),
      }
    )
    expect(response.status).toBe(403)
  })

  it('returns 400 when league is not in setup status', async () => {
    const { client } = await createTestUser()

    // Create league
    const createResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ name: 'Test League', max_participants: 2 }),
      }
    )
    const { league } = await createResponse.json()
    testIds.push(league.id)

    // Start draft to change status
    await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/start-draft`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ league_id: league.id }),
      }
    )

    // Try to generate link
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ league_id: league.id }),
      }
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('setup')
  })

  it('successfully generates join link', async () => {
    const { client } = await createTestUser()

    // Create league
    const createResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ name: 'Test League', max_participants: 8 }),
      }
    )
    const { league } = await createResponse.json()
    testIds.push(league.id)

    // Generate join link
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ league_id: league.id }),
      }
    )
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.join_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(data.join_token).toMatch(/^[0-9a-f-]{36}$/)
    expect(data.join_url).toContain(data.join_code)
  })

  it('regenerating replaces existing code', async () => {
    const { client } = await createTestUser()

    // Create league
    const createResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ name: 'Test League', max_participants: 8 }),
      }
    )
    const { league } = await createResponse.json()
    testIds.push(league.id)

    const token = (await client.auth.getSession()).data.session?.access_token

    // Generate first link
    const response1 = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ league_id: league.id }),
      }
    )
    const data1 = await response1.json()

    // Generate second link (regenerate)
    const response2 = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ league_id: league.id }),
      }
    )
    const data2 = await response2.json()

    expect(data2.join_code).not.toBe(data1.join_code)
    expect(data2.join_token).not.toBe(data1.join_token)
  })

  it('cleanup test data', async () => {
    await cleanupTestData(testIds)
  })
})
```

**Step 3.2: Create the Edge Function**

Create `supabase/functions/generate-join-link/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  errorResponse,
  handleCorsPreflightRequest,
  isValidUUID,
  generateJoinCode,
} from '../_shared/utils.ts'

interface GenerateJoinLinkRequest {
  league_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Authenticate user
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Parse request
    const { league_id }: GenerateJoinLinkRequest = await req.json()

    if (!league_id) {
      return errorResponse('league_id is required', 400)
    }

    if (!isValidUUID(league_id)) {
      return errorResponse('Invalid league_id', 400)
    }

    // Service client for database operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('id, owner_id, status, name')
      .eq('id', league_id)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // Check ownership
    if (league.owner_id !== user.id) {
      return errorResponse('Only the league owner can generate join links', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot generate join link after draft has started', 400)
    }

    // Generate new join code and token
    const join_code = generateJoinCode()
    const join_token = crypto.randomUUID()

    // Update league
    const { error: updateError } = await serviceClient
      .from('leagues')
      .update({ join_code, join_token })
      .eq('id', league_id)

    if (updateError) {
      console.error('Error updating league:', updateError)
      return errorResponse('Failed to generate join link', 500)
    }

    // Build join URL
    const appUrl = Deno.env.get('APP_URL') || 'https://fantasyreel.com'
    const join_url = `${appUrl}/join?code=${join_code}`

    return jsonResponse({
      join_code,
      join_token,
      join_url,
      league_id: league.id,
      league_name: league.name,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 3.3: Run the tests**

Run: `npm run test:functions 2>&1 | grep -E "generate-join-link|passed|failed"`

Expected: generate-join-link tests pass

**Step 3.4: Commit**

```bash
git add supabase/functions/generate-join-link/index.ts supabase/functions/tests/generate-join-link.test.ts
git commit -m "feat(api): add generate-join-link Edge Function"
```

---

## Task 4: Modify join-league to Accept Join Codes

**Files:**
- Modify: `supabase/functions/join-league/index.ts`
- Modify: `supabase/functions/tests/join-league.test.ts`

**Step 4.1: Add join code tests**

Add to `supabase/functions/tests/join-league.test.ts` (before the cleanup test):

```typescript
  it('returns 400 for invalid join code format', async () => {
    const { client } = await createTestUser()
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/join-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ join_code: 'invalid!' }),
      }
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid join code')
  })

  it('returns 404 for non-existent join code', async () => {
    const { client } = await createTestUser()
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/join-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await client.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ join_code: 'ABC123' }),
      }
    )
    expect(response.status).toBe(404)
  })

  it('successfully joins via join code', async () => {
    const { client: ownerClient } = await createTestUser()
    const { client: memberClient } = await createTestUser()

    // Create league
    const createResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await ownerClient.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ name: 'Join Code Test League', max_participants: 8 }),
      }
    )
    const { league } = await createResponse.json()
    testIds.push(league.id)

    // Generate join link
    const generateResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-join-link`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await ownerClient.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ league_id: league.id }),
      }
    )
    const { join_code } = await generateResponse.json()

    // Join via code
    const joinResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/join-league`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await memberClient.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ join_code, team_name: 'Code Joiners' }),
      }
    )
    expect(joinResponse.status).toBe(201)

    const data = await joinResponse.json()
    expect(data.league.id).toBe(league.id)
    expect(data.team.name).toBe('Code Joiners')
  })
```

**Step 4.2: Modify join-league/index.ts**

Update the interface and add join code handling. Replace the entire file:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsonResponse, errorResponse, handleCorsPreflightRequest, isValidUUID, isValidJoinCode } from '../_shared/utils.ts'

interface JoinLeagueRequest {
  league_id?: string
  invitation_token?: string
  join_code?: string
  join_token?: string
  team_name?: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Create user-authenticated client for auth validation
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the user from the JWT token
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Create service role client for database operations (bypasses RLS)
    // This is needed because users joining via invitation aren't participants yet,
    // so RLS would block their access to the league
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body
    const { league_id, invitation_token, join_code, join_token, team_name }: JoinLeagueRequest = await req.json()

    // Validate input - need one of: league_id, invitation_token, join_code, or join_token
    if (!league_id && !invitation_token && !join_code && !join_token) {
      return errorResponse('One of league_id, invitation_token, join_code, or join_token is required', 400)
    }

    let targetLeagueId: string

    // Handle invitation token flow (email-specific invitations)
    if (invitation_token) {
      if (!isValidUUID(invitation_token)) {
        return errorResponse('Invalid invitation token', 400)
      }

      // Look up invitation
      const { data: invitation, error: inviteError } = await serviceClient
        .from('invitations')
        .select('*')
        .eq('token', invitation_token)
        .single()

      if (inviteError || !invitation) {
        return errorResponse('Invalid or expired invitation', 404)
      }

      // Validate invitation status
      if (invitation.status !== 'pending') {
        return errorResponse(`Invitation has already been ${invitation.status}`, 400)
      }

      // Check expiration
      if (new Date(invitation.expires_at) < new Date()) {
        return errorResponse('Invitation has expired', 400)
      }

      // Verify email matches (case-insensitive)
      if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
        return errorResponse('This invitation was sent to a different email address', 403)
      }

      targetLeagueId = invitation.league_id

      // Update invitation status to accepted
      const { error: updateInviteError } = await serviceClient
        .from('invitations')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString()
        })
        .eq('id', invitation.id)

      if (updateInviteError) {
        console.error('Error updating invitation:', updateInviteError)
      }
    }
    // Handle join code flow (shareable links)
    else if (join_code) {
      const normalizedCode = join_code.toUpperCase().trim()
      if (!isValidJoinCode(normalizedCode)) {
        return errorResponse('Invalid join code', 400)
      }

      // Look up league by join code
      const { data: league, error: codeError } = await serviceClient
        .from('leagues')
        .select('id')
        .eq('join_code', normalizedCode)
        .single()

      if (codeError || !league) {
        return errorResponse('Invalid join code', 404)
      }

      targetLeagueId = league.id
    }
    // Handle join token flow (shareable UUID links)
    else if (join_token) {
      if (!isValidUUID(join_token)) {
        return errorResponse('Invalid join token', 400)
      }

      // Look up league by join token
      const { data: league, error: tokenError } = await serviceClient
        .from('leagues')
        .select('id')
        .eq('join_token', join_token)
        .single()

      if (tokenError || !league) {
        return errorResponse('Invalid join token', 404)
      }

      targetLeagueId = league.id
    }
    // Handle direct join flow
    else {
      if (!isValidUUID(league_id!)) {
        return errorResponse('Invalid league_id', 400)
      }
      targetLeagueId = league_id!
    }

    // Fetch the league
    const { data: league, error: leagueError } = await serviceClient
      .from('leagues')
      .select('*')
      .eq('id', targetLeagueId)
      .single()

    if (leagueError || !league) {
      return errorResponse('League not found', 404)
    }

    // For direct join (not via invitation or join code), check if league is open
    if (!invitation_token && !join_code && !join_token && league.invite_only) {
      return errorResponse('This league is invite-only', 403)
    }

    // Check league status
    if (league.status !== 'setup') {
      return errorResponse('Cannot join league - draft has already started', 400)
    }

    // Check if user is already a participant
    const { data: existingParticipant } = await serviceClient
      .from('league_participants')
      .select('id')
      .eq('league_id', targetLeagueId)
      .eq('user_id', user.id)
      .single()

    if (existingParticipant) {
      return errorResponse('You are already a member of this league', 400)
    }

    // Check if league is full
    const { count: participantCount } = await serviceClient
      .from('league_participants')
      .select('*', { count: 'exact', head: true })
      .eq('league_id', targetLeagueId)
      .eq('status', 'active')

    if (participantCount !== null && participantCount >= league.max_participants) {
      return errorResponse('League is full', 400)
    }

    // Calculate draft order (next available position)
    const draftOrder = (participantCount || 0) + 1

    // Create participant
    const { data: participant, error: participantError } = await serviceClient
      .from('league_participants')
      .insert({
        league_id: targetLeagueId,
        user_id: user.id,
        role: 'member',
        status: 'active',
        draft_order: draftOrder
      })
      .select()
      .single()

    if (participantError) {
      console.error('Error creating participant:', participantError)
      return errorResponse('Failed to join league', 500)
    }

    // Create team
    const defaultTeamName = team_name?.trim() || `${user.email?.split('@')[0]}'s Production Company`
    const { data: team, error: teamError } = await serviceClient
      .from('teams')
      .insert({
        participant_id: participant.id,
        name: defaultTeamName
      })
      .select()
      .single()

    if (teamError) {
      console.error('Error creating team:', teamError)
      return jsonResponse({
        participant,
        league: { id: league.id, name: league.name },
        warning: 'Joined league but failed to create team'
      }, 201)
    }

    return jsonResponse({
      participant,
      team,
      league: { id: league.id, name: league.name }
    }, 201)

  } catch (error) {
    console.error('Unexpected error:', error)
    return errorResponse('Internal server error', 500)
  }
})
```

**Step 4.3: Run the tests**

Run: `npm run test:functions 2>&1 | grep -E "join-league|passed|failed"`

Expected: join-league tests pass (including new join code tests)

**Step 4.4: Commit**

```bash
git add supabase/functions/join-league/index.ts supabase/functions/tests/join-league.test.ts
git commit -m "feat(api): add join code support to join-league"
```

---

## Task 5: Frontend - JoinLinkSection Component

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/settings/components/JoinLinkSection.tsx`

**Step 5.1: Create the component**

Create `apps/frontend/app/(authenticated)/league/[id]/settings/components/JoinLinkSection.tsx`:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Link2, Copy, RefreshCw, Check } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { League } from '@/types'
import { SectionHeader, LockedMessage } from './shared'

interface Props {
  league: League
  isLocked: boolean
  onUpdate: (league: League) => void
}

interface GenerateResponse {
  join_code: string
  join_token: string
  join_url: string
}

export default function JoinLinkSection({
  league,
  isLocked,
  onUpdate,
}: Props): React.ReactElement {
  const [showConfirm, setShowConfirm] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const generateAction = useCallback(async () => {
    const { data, error } = await callEdgeFunction<GenerateResponse>('generate-join-link', {
      body: { league_id: league.id },
    })
    if (error) throw new Error(error)
    return data
  }, [league.id])

  const { execute: generateLink, isLoading } = useAsyncAction(generateAction)

  const handleGenerate = async () => {
    const data = await generateLink()
    if (data) {
      onUpdate({
        ...league,
        join_code: data.join_code,
        join_token: data.join_token,
      } as League)
      toast.success('Join link generated!')
      setShowConfirm(false)
    }
  }

  const handleRegenerate = () => {
    setShowConfirm(true)
  }

  const copyToClipboard = async (text: string, type: 'code' | 'url') => {
    await navigator.clipboard.writeText(text)
    if (type === 'code') {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } else {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    }
    toast.success('Copied to clipboard!')
  }

  const joinUrl = league.join_code
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://fantasyreel.com'}/join?code=${league.join_code}`
    : null

  const hasJoinLink = Boolean(league.join_code)

  return (
    <>
      <section className="card p-6">
        <SectionHeader
          icon={Link2}
          title="Shareable Join Link"
          description={isLocked ? 'Locked after draft starts' : 'Anyone with this link can join your league'}
          isLocked={isLocked}
        />

        {isLocked && (
          <div className="mb-4">
            <LockedMessage message="Join links cannot be generated or changed after the draft has started." />
          </div>
        )}

        {!hasJoinLink ? (
          <div className="text-center py-6">
            <p className="text-foreground-muted mb-4">No join link generated yet</p>
            <button
              onClick={handleGenerate}
              disabled={isLoading || isLocked}
              className="btn btn-primary"
            >
              {isLoading ? 'Generating...' : 'Generate Join Link'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Join Code */}
            <div className="flex items-center justify-between p-3 bg-elevated rounded-lg">
              <div>
                <p className="text-xs text-foreground-muted mb-1">Join Code</p>
                <p className="text-xl font-mono font-bold text-gold tracking-wider">
                  {league.join_code}
                </p>
              </div>
              <button
                onClick={() => copyToClipboard(league.join_code!, 'code')}
                className="btn btn-ghost p-2"
                title="Copy code"
              >
                {copiedCode ? (
                  <Check className="w-5 h-5 text-success" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Join URL */}
            <div className="p-3 bg-elevated rounded-lg">
              <p className="text-xs text-foreground-muted mb-1">Join URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-foreground-secondary break-all">
                  {joinUrl}
                </code>
                <button
                  onClick={() => copyToClipboard(joinUrl!, 'url')}
                  className="btn btn-ghost p-2 shrink-0"
                  title="Copy URL"
                >
                  {copiedUrl ? (
                    <Check className="w-5 h-5 text-success" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Regenerate button */}
            {!isLocked && (
              <button
                onClick={handleRegenerate}
                disabled={isLoading}
                className="btn btn-secondary w-full"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Regenerate Link
              </button>
            )}
          </div>
        )}
      </section>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div
            className="card p-6 max-w-md w-full mx-4 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-display font-bold text-foreground mb-2">
              Regenerate Join Link?
            </h3>
            <p className="text-foreground-secondary mb-4">
              This will create a new join code and invalidate the old one. Anyone with the old link
              won&apos;t be able to use it.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="btn btn-ghost flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={isLoading}
                className="btn btn-primary flex-1"
              >
                {isLoading ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

**Step 5.2: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/settings/components/JoinLinkSection.tsx
git commit -m "feat(ui): add JoinLinkSection component for shareable links"
```

---

## Task 6: Update League Type and Settings Page

**Files:**
- Modify: `apps/frontend/types/index.ts`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/settings/SettingsClient.tsx`

**Step 6.1: Update League type**

Add to the League interface in `apps/frontend/types/index.ts`:

```typescript
  join_code?: string | null
  join_token?: string | null
```

**Step 6.2: Update SettingsClient to include JoinLinkSection**

Modify `apps/frontend/app/(authenticated)/league/[id]/settings/SettingsClient.tsx`:

Add import:
```typescript
import JoinLinkSection from './components/JoinLinkSection'
```

Add the section after LeagueInfoSection (around line 58):
```tsx
        <JoinLinkSection
          league={league}
          isLocked={!isSetup}
          onUpdate={handleLeagueUpdate}
        />
```

**Step 6.3: Verify the build**

Run: `cd /Users/ariksmith/Dev/projects/fantasy-reel/.worktrees/shareable-join-links && npm run build 2>&1 | tail -20`

Expected: Build succeeds

**Step 6.4: Commit**

```bash
git add apps/frontend/types/index.ts apps/frontend/app/(authenticated)/league/[id]/settings/SettingsClient.tsx
git commit -m "feat(ui): integrate JoinLinkSection into league settings"
```

---

## Task 7: Update Join Page to Handle Join Codes

**Files:**
- Modify: `apps/frontend/app/(authenticated)/join/page.tsx`
- Modify: `apps/frontend/app/(authenticated)/join/JoinLeagueClient.tsx`

**Step 7.1: Update page.tsx to handle code param**

Replace `apps/frontend/app/(authenticated)/join/page.tsx`:

```tsx
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import JoinLeagueClient from './JoinLeagueClient'

interface PageProps {
  searchParams: Promise<{ token?: string; code?: string }>
}

export default async function JoinPage({ searchParams }: PageProps) {
  const { token, code } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Redirect to login with return URL
    const params = token ? `token=${token}` : code ? `code=${code}` : ''
    const returnUrl = params ? `/join?${params}` : '/join'
    redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`)
  }

  const displayName = user.user_metadata?.display_name || user.email || 'User'
  return <JoinLeagueClient token={token} code={code} userDisplayName={displayName} />
}
```

**Step 7.2: Update JoinLeagueClient to handle codes and manual entry**

Replace `apps/frontend/app/(authenticated)/join/JoinLeagueClient.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Clapperboard } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'

interface Props {
  token?: string
  code?: string
  userDisplayName?: string
}

interface JoinResponse {
  participant: {
    id: string
    league_id: string
  }
  team: {
    id: string
    name: string
  }
  league: {
    id: string
    name: string
  }
}

export default function JoinLeagueClient({ token, code, userDisplayName }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')
  const [manualCode, setManualCode] = useState('')

  const hasLink = Boolean(token || code)

  const handleJoin = async () => {
    const joinCode = code || manualCode.toUpperCase().trim()

    if (!token && !joinCode) {
      setError('Please enter a join code')
      return
    }

    setLoading(true)
    setError(null)

    const body = token
      ? { invitation_token: token, team_name: teamName.trim() || undefined }
      : { join_code: joinCode, team_name: teamName.trim() || undefined }

    const { data, error: joinError } = await callEdgeFunction<JoinResponse>('join-league', {
      body,
    })

    if (joinError) {
      setError(joinError)
      setLoading(false)
    } else if (data?.league) {
      router.push(`/league/${data.league.id}`)
    }
  }

  // No token or code - show manual entry form
  if (!hasLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="card p-8 max-w-md w-full animate-fade-in">
          <div className="text-center mb-6">
            <div className="flex justify-center mb-3">
              <Clapperboard className="w-12 h-12 text-gold" />
            </div>
            <h1 className="text-2xl font-bold font-display text-foreground">Join a League</h1>
            <p className="text-foreground-secondary mt-2">
              Enter the join code shared by your league owner
            </p>
            {userDisplayName && (
              <p className="text-sm text-foreground-muted mt-1">Joining as {userDisplayName}</p>
            )}
          </div>

          <div className="mb-4">
            <label htmlFor="joinCode" className="block text-sm font-medium text-foreground-secondary mb-1">
              Join Code
            </label>
            <input
              type="text"
              id="joinCode"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              className="input text-center text-2xl font-mono tracking-widest uppercase"
              autoComplete="off"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="teamName" className="block text-sm font-medium text-foreground-secondary mb-1">
              Team Name <span className="text-foreground-muted">(optional)</span>
            </label>
            <input
              type="text"
              id="teamName"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="My Production Company"
              className="input"
            />
          </div>

          {error && (
            <div className="alert alert-error mb-4">
              <p className="font-medium">Unable to join</p>
              <p className="text-sm opacity-90">{error}</p>
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={loading || manualCode.length < 6}
            className="btn btn-primary w-full py-3 text-lg"
          >
            {loading ? 'Joining...' : 'Join League'}
          </button>

          <p className="text-center text-sm text-foreground-muted mt-4">
            <Link href="/dashboard" className="text-gold hover:text-gold-hover transition-colors">
              Cancel and go to dashboard
            </Link>
          </p>
        </div>
      </div>
    )
  }

  // Has token or code - show join confirmation
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="card p-8 max-w-md w-full animate-fade-in">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <Clapperboard className="w-12 h-12 text-gold" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground">Join League</h1>
          <p className="text-foreground-secondary mt-2">
            {token
              ? "You've been invited to join a fantasy movie league!"
              : 'Join this fantasy movie league'}
          </p>
          {userDisplayName && (
            <p className="text-sm text-foreground-muted mt-1">Joining as {userDisplayName}</p>
          )}
        </div>

        <div className="mb-6">
          <label htmlFor="teamName" className="block text-sm font-medium text-foreground-secondary mb-1">
            Team Name <span className="text-foreground-muted">(optional)</span>
          </label>
          <input
            type="text"
            id="teamName"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="My Production Company"
            className="input"
          />
          <p className="text-xs text-foreground-muted mt-1">
            Leave blank to use a default name based on your username
          </p>
        </div>

        {error && (
          <div className="alert alert-error mb-4">
            <p className="font-medium">Unable to join</p>
            <p className="text-sm opacity-90">{error}</p>
          </div>
        )}

        <button
          onClick={handleJoin}
          disabled={loading}
          className="btn btn-primary w-full py-3 text-lg"
        >
          {loading ? 'Joining...' : 'Join League'}
        </button>

        <p className="text-center text-sm text-foreground-muted mt-4">
          <Link href="/dashboard" className="text-gold hover:text-gold-hover transition-colors">
            Cancel and go to dashboard
          </Link>
        </p>
      </div>
    </div>
  )
}
```

**Step 7.3: Verify the build**

Run: `cd /Users/ariksmith/Dev/projects/fantasy-reel/.worktrees/shareable-join-links && npm run build 2>&1 | tail -10`

Expected: Build succeeds

**Step 7.4: Commit**

```bash
git add apps/frontend/app/(authenticated)/join/page.tsx apps/frontend/app/(authenticated)/join/JoinLeagueClient.tsx
git commit -m "feat(ui): update join page to support join codes and manual entry"
```

---

## Task 8: Add Join Link to Dashboard (Setup Phase)

**Files:**
- Create: `apps/frontend/app/(authenticated)/league/[id]/components/JoinLinkCard.tsx`
- Modify: `apps/frontend/app/(authenticated)/league/[id]/dashboard/DashboardClient.tsx`

**Step 8.1: Create JoinLinkCard component**

Create `apps/frontend/app/(authenticated)/league/[id]/components/JoinLinkCard.tsx`:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Link2, Copy, Check, RefreshCw } from 'lucide-react'
import { callEdgeFunction } from '@/utils/supabase/functions'
import { useAsyncAction } from '@/hooks/useAsyncAction'
import type { League } from '@/types'

interface Props {
  league: League
  isOwner: boolean
  onUpdate: (league: League) => void
}

interface GenerateResponse {
  join_code: string
  join_token: string
  join_url: string
}

export default function JoinLinkCard({ league, isOwner, onUpdate }: Props): React.ReactElement | null {
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  const generateAction = useCallback(async () => {
    const { data, error } = await callEdgeFunction<GenerateResponse>('generate-join-link', {
      body: { league_id: league.id },
    })
    if (error) throw new Error(error)
    return data
  }, [league.id])

  const { execute: generateLink, isLoading } = useAsyncAction(generateAction)

  // Only show during setup phase
  if (league.status !== 'setup') return null

  // Only owners can generate links
  if (!isOwner && !league.join_code) return null

  const handleGenerate = async () => {
    const data = await generateLink()
    if (data) {
      onUpdate({
        ...league,
        join_code: data.join_code,
        join_token: data.join_token,
      } as League)
      toast.success('Join link generated!')
    }
  }

  const copyToClipboard = async (text: string, type: 'code' | 'url') => {
    await navigator.clipboard.writeText(text)
    if (type === 'code') {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } else {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    }
    toast.success('Copied!')
  }

  const joinUrl = league.join_code
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://fantasyreel.com'}/join?code=${league.join_code}`
    : null

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-5 h-5 text-gold" />
        <h3 className="font-display font-semibold text-foreground">Invite Players</h3>
      </div>

      {!league.join_code ? (
        isOwner && (
          <div className="text-center">
            <p className="text-sm text-foreground-muted mb-3">
              Generate a link to invite players
            </p>
            <button
              onClick={handleGenerate}
              disabled={isLoading}
              className="btn btn-primary btn-sm"
            >
              {isLoading ? 'Generating...' : 'Generate Join Link'}
            </button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-2 bg-elevated rounded">
            <span className="font-mono text-lg font-bold text-gold tracking-wider">
              {league.join_code}
            </span>
            <button
              onClick={() => copyToClipboard(league.join_code!, 'code')}
              className="btn btn-ghost p-1"
            >
              {copiedCode ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <button
            onClick={() => copyToClipboard(joinUrl!, 'url')}
            className="btn btn-secondary btn-sm w-full"
          >
            {copiedUrl ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            Copy Join Link
          </button>

          {isOwner && (
            <button
              onClick={handleGenerate}
              disabled={isLoading}
              className="btn btn-ghost btn-sm w-full text-foreground-muted"
            >
              <RefreshCw className={`w-3 h-3 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

**Step 8.2: Integrate into DashboardClient**

This requires knowing the current user's role. Update the Dashboard page and client to pass ownership info.

Modify `apps/frontend/app/(authenticated)/league/[id]/dashboard/page.tsx` to include isOwner:

Add after fetching league (around line 29):
```tsx
  const isOwner = league.owner_id === user.id
```

Update the return statement to pass isOwner and league to DashboardClient:
```tsx
  return (
    <DashboardClient
      league={league as League}
      userTeam={userTeam}
      totalTeams={participantsData.length}
      isOwner={isOwner}
    />
  )
```

**Step 8.3: Update DashboardClient props and add JoinLinkCard**

Modify `apps/frontend/app/(authenticated)/league/[id]/dashboard/DashboardClient.tsx`:

Update Props interface:
```typescript
interface Props {
  league: League
  userTeam: DashboardTeam | null
  totalTeams: number
  isOwner: boolean
}
```

Add import:
```typescript
import JoinLinkCard from '../components/JoinLinkCard'
```

Update function signature:
```typescript
export default function DashboardClient({
  league: initialLeague,
  userTeam,
  totalTeams,
  isOwner,
}: Props) {
```

Add handler for league updates:
```typescript
  function handleLeagueUpdate(updatedLeague: League): void {
    setLeague(updatedLeague)
  }
```

Add JoinLinkCard in the JSX (suitable location depends on existing layout - typically in a sidebar or at the top):

```tsx
      {league.status === 'setup' && (
        <JoinLinkCard
          league={league}
          isOwner={isOwner}
          onUpdate={handleLeagueUpdate}
        />
      )}
```

**Step 8.4: Verify build**

Run: `cd /Users/ariksmith/Dev/projects/fantasy-reel/.worktrees/shareable-join-links && npm run build 2>&1 | tail -10`

Expected: Build succeeds

**Step 8.5: Commit**

```bash
git add apps/frontend/app/(authenticated)/league/[id]/components/JoinLinkCard.tsx \
        apps/frontend/app/(authenticated)/league/[id]/dashboard/page.tsx \
        apps/frontend/app/(authenticated)/league/[id]/dashboard/DashboardClient.tsx
git commit -m "feat(ui): add JoinLinkCard to dashboard during setup phase"
```

---

## Task 9: Final Testing and Cleanup

**Step 9.1: Run all Edge Function tests**

Run: `npm run test:functions`

Expected: All tests pass (except pre-existing trade test failures)

**Step 9.2: Run frontend build**

Run: `npm run build`

Expected: Build succeeds with no errors

**Step 9.3: Manual testing checklist**

1. [ ] Generate join link in league settings
2. [ ] Copy code and URL work correctly
3. [ ] Regenerate creates new code, old one stops working
4. [ ] Join via URL with `?code=` parameter
5. [ ] Join via manual code entry on `/join`
6. [ ] Join link section appears on dashboard during setup
7. [ ] Join link hidden after draft starts

**Step 9.4: Create final commit**

```bash
git add -A
git status  # Review any remaining changes
git commit -m "feat: shareable join links for leagues

- Add join_code and join_token columns to leagues table
- Create generate-join-link Edge Function
- Update join-league to accept join codes
- Add JoinLinkSection to league settings
- Add JoinLinkCard to dashboard (setup phase only)
- Update join page for code-based joining and manual entry"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | Migration | Add `join_code`, `join_token` columns |
| 2 | `_shared/utils.ts` | Add `generateJoinCode`, `isValidJoinCode` |
| 3 | `generate-join-link/` | New Edge Function + tests |
| 4 | `join-league/` | Add join code support |
| 5 | `JoinLinkSection.tsx` | Settings component |
| 6 | Types + `SettingsClient` | Integrate into settings |
| 7 | Join page | Handle codes + manual entry |
| 8 | `JoinLinkCard` + Dashboard | Show on dashboard during setup |
| 9 | Testing | Verify everything works |
