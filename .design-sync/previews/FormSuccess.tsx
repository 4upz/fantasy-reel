import { FormSuccess } from 'fantasy-reel'

export const Default = () => (
  <div className="max-w-md">
    <FormSuccess message="Invitation sent to bob@fantasyreel.test." />
  </div>
)

export const AfterSaving = () => (
  <div className="max-w-md">
    <FormSuccess message="Draft settings saved." />
    <div className="mt-3">
      <FormSuccess message="Your team name is now The Godfathers." />
    </div>
  </div>
)

/** A null or empty message renders nothing at all. */
export const Empty = () => (
  <div className="max-w-md">
    <FormSuccess message={null} />
    <p className="text-sm text-foreground-muted">Nothing renders above this line.</p>
  </div>
)
