import MovieCardSkeleton from './MovieCardSkeleton'

interface Props {
  count?: number
}

/** @design-system Feedback */
export default function MovieGridSkeleton({ count = 12 }: Props): React.ReactElement {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
      {Array.from({ length: count }, (_, index) => (
        <MovieCardSkeleton key={index} index={index} />
      ))}
    </div>
  )
}
