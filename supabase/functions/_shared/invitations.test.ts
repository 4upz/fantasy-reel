import { assertEquals } from '@std/assert'
import { ownerVisibleEmail, toOwnerInvitation } from './invitations.ts'

Deno.test('ownerVisibleEmail keeps an address the owner typed', () => {
  assertEquals(ownerVisibleEmail({ email: 'typed@example.com', invited_user_id: null }), 'typed@example.com')
})

Deno.test('ownerVisibleEmail withholds an address resolved from a username invite', () => {
  assertEquals(
    ownerVisibleEmail({ email: 'resolved@example.com', invited_user_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    null
  )
})

Deno.test('toOwnerInvitation keeps every other field', () => {
  const row = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567891',
    email: 'resolved@example.com',
    invited_user_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    status: 'pending',
  }
  assertEquals(toOwnerInvitation(row), { ...row, email: null })
})
