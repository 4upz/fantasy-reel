import { assertEquals } from '@std/assert'
import { escapeLikePattern, maskEmail } from './user-search.ts'

Deno.test('maskEmail masks the local part and the domain, keeping the TLD', () => {
  assertEquals(maskEmail('john@example.com'), 'j***@e***.com')
  assertEquals(maskEmail('alice@fantasyreel.test'), 'a***@f***.test')
  assertEquals(maskEmail('a@mail.co.uk'), 'a***@m***.uk')
})

Deno.test('maskEmail handles malformed addresses without leaking them', () => {
  assertEquals(maskEmail('no-at-sign'), '***')
  assertEquals(maskEmail('@example.com'), '***')
  assertEquals(maskEmail('bob@localhost'), 'b***@l***')
})

Deno.test('escapeLikePattern makes ILIKE wildcards literal', () => {
  assertEquals(escapeLikePattern('__'), '\\_\\_')
  assertEquals(escapeLikePattern('100%'), '100\\%')
  assertEquals(escapeLikePattern('**'), '\\*\\*')
  assertEquals(escapeLikePattern('a\\b'), 'a\\\\b')
  assertEquals(escapeLikePattern('Alice Spielberg'), 'Alice Spielberg')
})
