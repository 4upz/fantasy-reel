import { UserSearchResultItem } from 'fantasy-reel'

const alice = {
  user_id: 'a1b2c3d4-e5f6-4a90-abcd-ef1234567890',
  display_name: 'Alice Spielberg',
  email_hint: 'a•••e@fantasyreel.test',
  avatar_url: null,
}

const bob = {
  user_id: 'b2c3d4e5-f6a7-4b01-bcde-f12345678901',
  display_name: 'Bob Nolan',
  email_hint: 'b•••b@fantasyreel.test',
  avatar_url: null,
}

const carol = {
  user_id: 'c3d4e5f6-a7b8-4c12-cdef-123456789012',
  display_name: 'Carol Coppola',
  email_hint: 'c•••l@fantasyreel.test',
  avatar_url: null,
}

const noop = () => {}

/** A single match. Email is always shown hinted, never in full. */
export const Default = () => (
  <div className="max-w-sm rounded-lg bg-surface border border-border overflow-hidden">
    <UserSearchResultItem user={alice} onSelect={noop} />
  </div>
)

/** `isHighlighted` marks the keyboard-focused row during arrow navigation. */
export const ResultsList = () => (
  <div className="max-w-sm rounded-lg bg-surface border border-border overflow-hidden">
    <UserSearchResultItem user={alice} onSelect={noop} isHighlighted />
    <UserSearchResultItem user={bob} onSelect={noop} />
    <UserSearchResultItem user={carol} onSelect={noop} />
  </div>
)

/** Long names truncate rather than wrapping the row. */
export const LongName = () => (
  <div className="max-w-sm rounded-lg bg-surface border border-border overflow-hidden">
    <UserSearchResultItem
      user={{
        ...bob,
        display_name: 'Bartholomew Christopher Nolan-Villeneuve',
        email_hint: 'b•••••••••••••e@fantasyreel.test',
      }}
      onSelect={noop}
    />
  </div>
)
