import Illustration, { type IllustrationSize } from './Illustration'

interface Props {
  size?: IllustrationSize
  className?: string
}

export default function Discovering({ size = 'md', className }: Props): React.ReactElement {
  return (
    <Illustration size={size} alt="Discover movies to add to your draft" className={className}>
      <svg viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-auto">
        {/* Background glow */}
        <ellipse cx="150" cy="180" rx="130" ry="20" fill="#c9a227" fillOpacity="0.08" />

        {/* Film reel base */}
        <circle cx="100" cy="110" r="55" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="2" />
        <circle cx="100" cy="110" r="45" fill="#1c1c1c" stroke="#3a3a3a" strokeWidth="1.5" />
        <circle cx="100" cy="110" r="15" fill="#2a2a2a" stroke="#c9a227" strokeWidth="2" />

        {/* Film reel holes */}
        {[0, 60, 120, 180, 240, 300].map((angle, i) => {
          const rad = (angle * Math.PI) / 180
          const x = 100 + 30 * Math.cos(rad)
          const y = 110 + 30 * Math.sin(rad)
          return <circle key={i} cx={x} cy={y} r="6" fill="#0f0f0f" stroke="#3a3a3a" strokeWidth="1" />
        })}

        {/* Film strip coming out */}
        <path
          d="M145 95 Q180 90 200 70 Q220 50 250 55"
          stroke="#2a2a2a"
          strokeWidth="20"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M145 95 Q180 90 200 70 Q220 50 250 55"
          stroke="#3a3a3a"
          strokeWidth="18"
          fill="none"
          strokeLinecap="round"
        />

        {/* Film frames on the strip */}
        <g>
          <rect x="165" y="78" width="16" height="12" rx="1" fill="#c9a227" fillOpacity="0.4" />
          <rect x="190" y="62" width="16" height="12" rx="1" fill="#c9a227" fillOpacity="0.5" />
          <rect x="218" y="50" width="16" height="12" rx="1" fill="#c9a227" fillOpacity="0.6" />
          <rect x="240" y="48" width="16" height="12" rx="1" fill="#c9a227" fillOpacity="0.7" />
        </g>

        {/* Magnifying glass */}
        <circle cx="220" cy="130" r="35" fill="none" stroke="#c9a227" strokeWidth="4" />
        <circle cx="220" cy="130" r="30" fill="#c9a227" fillOpacity="0.1" />
        <line x1="246" y1="156" x2="270" y2="180" stroke="#c9a227" strokeWidth="6" strokeLinecap="round" />

        {/* Sparkles inside magnifying glass */}
        <circle cx="210" cy="120" r="3" fill="#c9a227" fillOpacity="0.8" />
        <circle cx="225" cy="125" r="2" fill="#c9a227" fillOpacity="0.6" />
        <circle cx="215" cy="138" r="2" fill="#c9a227" fillOpacity="0.7" />

        {/* Small decorative stars */}
        <g fill="#c9a227" fillOpacity="0.5">
          <polygon points="60,40 62,46 68,46 63,50 65,56 60,52 55,56 57,50 52,46 58,46" />
          <polygon points="280,90 281,94 285,94 282,97 283,101 280,98 277,101 278,97 275,94 279,94" transform="scale(0.8)" />
        </g>

        {/* Movie clapperboard hint */}
        <g transform="translate(45, 160)">
          <rect x="0" y="0" width="40" height="25" rx="2" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="1" />
          <rect x="0" y="0" width="40" height="8" rx="2" fill="#3a3a3a" />
          <line x1="8" y1="0" x2="5" y2="8" stroke="#2a2a2a" strokeWidth="2" />
          <line x1="18" y1="0" x2="15" y2="8" stroke="#2a2a2a" strokeWidth="2" />
          <line x1="28" y1="0" x2="25" y2="8" stroke="#2a2a2a" strokeWidth="2" />
        </g>

        {/* Popcorn piece accents */}
        <circle cx="260" cy="120" r="4" fill="#fff8e7" fillOpacity="0.6" />
        <circle cx="50" cy="70" r="3" fill="#fff8e7" fillOpacity="0.5" />
      </svg>
    </Illustration>
  )
}
