import Illustration, { type IllustrationSize } from './Illustration'

interface Props {
  size?: IllustrationSize
  className?: string
}

export default function NoResults({ size = 'sm', className }: Props): React.ReactElement {
  return (
    <Illustration size={size} alt="No movies found" className={className}>
      <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-auto">
        {/* Background shadow */}
        <ellipse cx="100" cy="140" rx="70" ry="10" fill="#c9a227" fillOpacity="0.08" />

        {/* Empty popcorn bucket */}
        <path
          d="M60 50 L50 120 L150 120 L140 50 Z"
          fill="#c9a227"
          stroke="#a8851f"
          strokeWidth="2"
        />
        <path
          d="M60 50 L140 50"
          stroke="#a8851f"
          strokeWidth="2"
        />
        {/* Bucket stripes */}
        <path d="M65 50 L56 120" stroke="#a8851f" strokeWidth="1" strokeOpacity="0.5" />
        <path d="M85 50 L78 120" stroke="#a8851f" strokeWidth="1" strokeOpacity="0.5" />
        <path d="M105 50 L100 120" stroke="#a8851f" strokeWidth="1" strokeOpacity="0.5" />
        <path d="M125 50 L122 120" stroke="#a8851f" strokeWidth="1" strokeOpacity="0.5" />

        {/* Sad face on bucket */}
        <circle cx="80" cy="80" r="4" fill="#8a7020" />
        <circle cx="120" cy="80" r="4" fill="#8a7020" />
        <path d="M85 100 Q100 92 115 100" stroke="#8a7020" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* A few fallen popcorn pieces */}
        <circle cx="35" cy="125" r="5" fill="#fff8e7" fillOpacity="0.7" />
        <circle cx="165" cy="128" r="4" fill="#fff8e7" fillOpacity="0.6" />
        <circle cx="45" cy="130" r="4" fill="#fff8e7" fillOpacity="0.5" />
        <circle cx="158" cy="135" r="3" fill="#fff8e7" fillOpacity="0.4" />

        {/* Question marks floating */}
        <text x="30" y="40" fill="#3a3a3a" fontSize="20" fontFamily="system-ui" fontWeight="bold">?</text>
        <text x="165" y="35" fill="#3a3a3a" fontSize="16" fontFamily="system-ui" fontWeight="bold">?</text>

        {/* X marks to indicate "not found" */}
        <g stroke="#a8505c" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.6">
          <line x1="22" y1="65" x2="32" y2="75" />
          <line x1="32" y1="65" x2="22" y2="75" />
        </g>
        <g stroke="#a8505c" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.5">
          <line x1="170" y1="70" x2="178" y2="78" />
          <line x1="178" y1="70" x2="170" y2="78" />
        </g>
      </svg>
    </Illustration>
  )
}
