export default function BiddingModalLoading(): React.ReactElement {
  return (
    <div className="modal-overlay" role="status">
      {/* A live region speaks its text, not an aria-label. */}
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-[85dvh] max-w-2xl w-full mx-4 rounded-2xl" aria-hidden="true" />
    </div>
  )
}
