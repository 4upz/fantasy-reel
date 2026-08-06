import { FormError } from 'fantasy-reel'

export const Default = () => (
  <div className="max-w-md">
    <FormError message="That email is already on this league's roster." />
  </div>
)

/** Field-level validation, shown directly beneath the input it refers to. */
export const UnderAField = () => (
  <div className="max-w-md">
    <label className="block text-sm font-medium text-foreground mb-2">League name</label>
    <input className="input w-full" defaultValue="" placeholder="Summer Blockbusters" />
    <div className="mt-2">
      <FormError message="League name must be at least 3 characters." />
    </div>
  </div>
)

/** A null or empty message renders nothing at all — no empty box. */
export const Empty = () => (
  <div className="max-w-md">
    <FormError message={null} />
    <p className="text-sm text-foreground-muted">Nothing renders above this line.</p>
  </div>
)
