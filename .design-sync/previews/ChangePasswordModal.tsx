import { ChangePasswordModal } from 'fantasy-reel'
import { Stage } from './_stage'

const noop = () => {}

/** Account password change: current password, new password, confirmation, each
    with its own show/hide toggle. */
export const Default = () => (
  <Stage width={820} height={620}>
    <ChangePasswordModal onClose={noop} onSubmit={async () => ({ success: true })} />
  </Stage>
)

/**
 * Not previewed: validation and server-error states. Both only appear after
 * the user submits, and the modal owns that state internally — a static render
 * always shows the empty form, so an "error" cell would be indistinguishable
 * from the default one. The card is live React: type and submit in the design
 * pane to see them.
 */
