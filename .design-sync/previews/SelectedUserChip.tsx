import { SelectedUserChip } from 'fantasy-reel'

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

const noop = () => {}

export const Default = () => (
  <div className="flex items-start">
    <SelectedUserChip user={alice} onRemove={noop} />
  </div>
)

/** Chips wrap above the search field as invitees are picked. */
export const SeveralSelected = () => (
  <div className="flex flex-wrap gap-2 max-w-md">
    <SelectedUserChip user={alice} onRemove={noop} />
    <SelectedUserChip user={bob} onRemove={noop} />
    <SelectedUserChip
      user={{ ...alice, user_id: 'x', display_name: 'Dave Kubrick' }}
      onRemove={noop}
    />
  </div>
)

/** In situ: above the invite field it feeds. */
export const AboveAnInviteField = () => (
  <div className="max-w-md">
    <label className="block text-sm font-medium text-foreground mb-2">Invite players</label>
    <div className="flex flex-wrap gap-2 mb-3">
      <SelectedUserChip user={alice} onRemove={noop} />
      <SelectedUserChip user={bob} onRemove={noop} />
    </div>
    <input className="input w-full" placeholder="Search by name or email…" />
  </div>
)
