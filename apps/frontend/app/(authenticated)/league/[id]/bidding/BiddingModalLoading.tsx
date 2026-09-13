export default function BiddingModalLoading(): React.ReactElement {
  return (
    <div className="modal-overlay" role="status" aria-label="Loading bidding dialog">
      <div className="skeleton h-[85dvh] max-w-2xl w-full mx-4 rounded-2xl" aria-hidden="true" />
    </div>
  )
}
