import { DraftProgressRing } from 'fantasy-reel'

/** Gold while the draft is running; the ring turns green and gains a check the
    moment the last pick lands. */
export const Progress = () => (
  <div className="flex items-center gap-8">
    <DraftProgressRing current={0} total={25} />
    <DraftProgressRing current={11} total={25} />
    <DraftProgressRing current={25} total={25} />
  </div>
)

export const Sizes = () => (
  <div className="flex items-center gap-8">
    <DraftProgressRing current={14} total={25} size="sm" />
    <DraftProgressRing current={14} total={25} size="md" />
    <DraftProgressRing current={14} total={25} size="lg" />
  </div>
)

/** Drop the caption where the surrounding panel already names the draft. */
export const WithoutLabel = () => (
  <div className="flex items-center gap-8">
    <DraftProgressRing current={14} total={25} showLabel={false} />
    <DraftProgressRing current={14} total={25} />
  </div>
)

export const Complete = () => <DraftProgressRing current={25} total={25} size="lg" />
