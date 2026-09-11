import { ConfirmStartSeasonModal } from 'fantasy-reel'
import { Stage } from './_stage'

const noop = () => {}

/** Everyone being carried over is named — the point of the confirm step. */
export const Default = () => (
  <Stage width={820} height={620}>
    <ConfirmStartSeasonModal
      seasonYear={2027}
      previousSeasonYear={2026}
      participantNames={['Alice Spielberg', 'Bob Nolan', 'Carol Coppola', 'Dave Kubrick']}
      isLoading={false}
      onConfirm={noop}
      onCancel={noop}
    />
  </Stage>
)

/** Mid-create: the rollover is in flight. */
export const Loading = () => (
  <Stage width={820} height={620}>
    <ConfirmStartSeasonModal
      seasonYear={2027}
      previousSeasonYear={2026}
      participantNames={['Alice Spielberg', 'Bob Nolan']}
      isLoading
      onConfirm={noop}
      onCancel={noop}
    />
  </Stage>
)
