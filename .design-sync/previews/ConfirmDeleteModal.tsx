import { ConfirmDeleteModal } from 'fantasy-reel'
import { Stage } from './_stage'

const noop = () => {}
const noopAsync = async () => {}

/**
 * Destructive confirmation for deleting a league. The confirm button stays
 * disabled until the league name is typed exactly — a deliberate friction
 * gate, so the resting state of this modal is "cannot proceed".
 */
export const Default = () => (
  <Stage width={820} height={460}>
    <ConfirmDeleteModal
      leagueName="Summer Blockbusters"
      onConfirm={noopAsync}
      onCancel={noop}
      loading={false}
    />
  </Stage>
)

/** Mid-delete: the action is in flight. */
export const Loading = () => (
  <Stage width={820} height={460}>
    <ConfirmDeleteModal
      leagueName="Summer Blockbusters"
      onConfirm={noopAsync}
      onCancel={noop}
      loading
    />
  </Stage>
)
