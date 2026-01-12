interface Props {
  index?: number
}

export default function MovieCardSkeleton({ index = 0 }: Props): React.ReactElement {
  return (
    <div
      className="rounded-xl overflow-hidden bg-surface border border-border animate-fade-in"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-elevated">
        <div className="absolute inset-0 skeleton" />
      </div>
      <div className="p-3">
        <div className="h-5 w-3/4 rounded skeleton" />
        <div className="h-4 w-16 rounded skeleton mt-2" />
      </div>
    </div>
  )
}
