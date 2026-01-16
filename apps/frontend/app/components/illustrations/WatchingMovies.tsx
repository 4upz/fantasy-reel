import Illustration, { type IllustrationSize } from './Illustration'

interface Props {
  size?: IllustrationSize
  className?: string
}

export default function WatchingMovies({ size = 'lg', className }: Props): React.ReactElement {
  return (
    <Illustration size={size} alt="Person relaxing and watching movies" className={className}>
      <svg viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-auto">
        {/* Background glow */}
        <ellipse cx="200" cy="280" rx="150" ry="20" fill="#c9a227" fillOpacity="0.1" />

        {/* Couch */}
        <path
          d="M80 200 Q80 180 100 180 L300 180 Q320 180 320 200 L320 240 Q320 250 310 250 L90 250 Q80 250 80 240 Z"
          fill="#2a2a2a"
          stroke="#3a3a3a"
          strokeWidth="2"
        />
        <path
          d="M70 200 Q70 190 80 190 L80 240 Q70 240 70 230 Z"
          fill="#2a2a2a"
          stroke="#3a3a3a"
          strokeWidth="2"
        />
        <path
          d="M320 190 Q330 190 330 200 L330 230 Q330 240 320 240 Z"
          fill="#2a2a2a"
          stroke="#3a3a3a"
          strokeWidth="2"
        />

        {/* Person body */}
        <ellipse cx="200" cy="170" rx="35" ry="25" fill="#3d3d3d" />

        {/* Person head */}
        <circle cx="200" cy="130" r="25" fill="#e8d5c4" />

        {/* Hair */}
        <path
          d="M180 115 Q180 100 200 100 Q220 100 220 115 Q225 110 220 120 L180 120 Q175 110 180 115"
          fill="#4a3728"
        />

        {/* Face features */}
        <circle cx="192" cy="128" r="2" fill="#2a2a2a" />
        <circle cx="208" cy="128" r="2" fill="#2a2a2a" />
        <path d="M195 138 Q200 142 205 138" stroke="#2a2a2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />

        {/* Arms holding popcorn */}
        <path
          d="M170 160 Q150 170 155 190"
          stroke="#e8d5c4"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M230 160 Q250 170 245 190"
          stroke="#e8d5c4"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
        />

        {/* Popcorn bucket */}
        <path
          d="M175 185 L185 220 L215 220 L225 185 Z"
          fill="#c9a227"
          stroke="#a8851f"
          strokeWidth="2"
        />
        <path d="M175 185 L225 185" stroke="#a8851f" strokeWidth="2" />
        {/* Popcorn pieces */}
        <circle cx="190" cy="178" r="6" fill="#fff8e7" />
        <circle cx="200" cy="175" r="7" fill="#fff8e7" />
        <circle cx="210" cy="178" r="6" fill="#fff8e7" />
        <circle cx="195" cy="170" r="5" fill="#fff8e7" />
        <circle cx="205" cy="172" r="5" fill="#fff8e7" />

        {/* TV/Screen */}
        <rect x="120" y="40" width="160" height="90" rx="4" fill="#1c1c1c" stroke="#3a3a3a" strokeWidth="2" />
        <rect x="128" y="48" width="144" height="74" rx="2" fill="#2a2a2a" />

        {/* Screen content - abstract movie scene */}
        <rect x="128" y="48" width="144" height="74" fill="url(#screenGradient)" />
        <circle cx="180" cy="85" r="15" fill="#c9a227" fillOpacity="0.6" />
        <circle cx="220" cy="75" r="10" fill="#a8505c" fillOpacity="0.5" />

        {/* TV stand */}
        <rect x="190" y="130" width="20" height="30" fill="#2a2a2a" />
        <rect x="170" y="155" width="60" height="8" rx="2" fill="#2a2a2a" />

        {/* Ambient light from screen */}
        <ellipse cx="200" cy="85" rx="100" ry="50" fill="url(#ambientGlow)" />

        <defs>
          <radialGradient id="ambientGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#c9a227" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="screenGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1a1a2e" />
            <stop offset="100%" stopColor="#16213e" />
          </linearGradient>
        </defs>
      </svg>
    </Illustration>
  )
}
