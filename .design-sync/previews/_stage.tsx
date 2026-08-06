// Shared overlay stage for modal previews. Not a component preview — the
// converter iterates the component list, so this module is simply ignored.
//
// Modals root at `position: fixed`, which is out of flow: the preview mount
// would collapse to zero height and the card would capture as empty. A
// `transform` on an ancestor makes it the containing block for fixed
// descendants, so the overlay is sized and captured properly.
export const Stage = ({
  children,
  width = 1040,
  height = 720,
}: {
  children: React.ReactNode
  width?: number
  height?: number
}) => (
  <div
    style={{
      position: 'relative',
      width,
      height,
      transform: 'translateZ(0)',
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
)
