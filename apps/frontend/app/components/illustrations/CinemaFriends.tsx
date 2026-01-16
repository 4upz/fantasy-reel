import Illustration, { type IllustrationSize } from './Illustration'

interface Props {
  size?: IllustrationSize
  className?: string
}

export default function CinemaFriends({ size = 'lg', className }: Props): React.ReactElement {
  return (
    <Illustration size={size} alt="Friends enjoying movies together" className={className}>
      <svg viewBox="0 0 400 300" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-auto">
        {/* Background glow */}
        <ellipse cx="200" cy="280" rx="160" ry="20" fill="#c9a227" fillOpacity="0.1" />

        {/* Theater seats row */}
        <path
          d="M40 220 Q40 200 60 200 L340 200 Q360 200 360 220 L360 260 Q360 270 350 270 L50 270 Q40 270 40 260 Z"
          fill="#2a2a2a"
          stroke="#3a3a3a"
          strokeWidth="2"
        />

        {/* Seat dividers */}
        <line x1="140" y1="200" x2="140" y2="270" stroke="#3a3a3a" strokeWidth="2" />
        <line x1="260" y1="200" x2="260" y2="270" stroke="#3a3a3a" strokeWidth="2" />

        {/* Person 1 - Left */}
        <ellipse cx="90" cy="185" rx="30" ry="20" fill="#3d3d3d" />
        <circle cx="90" cy="150" r="22" fill="#d4c4b0" />
        <path d="M72 135 Q72 120 90 120 Q108 120 108 135" fill="#2a1810" />
        <circle cx="83" cy="148" r="2" fill="#2a2a2a" />
        <circle cx="97" cy="148" r="2" fill="#2a2a2a" />
        <path d="M85 158 Q90 162 95 158" stroke="#2a2a2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />

        {/* Person 2 - Center (taller, reaching up excited) */}
        <ellipse cx="200" cy="175" rx="32" ry="22" fill="#4a4a4a" />
        <circle cx="200" cy="138" r="24" fill="#e8d5c4" />
        <path d="M180 125 Q180 108 200 108 Q220 108 220 125 Q225 118 222 128 L178 128 Q175 118 180 125" fill="#5c4033" />
        <circle cx="192" cy="136" r="2" fill="#2a2a2a" />
        <circle cx="208" cy="136" r="2" fill="#2a2a2a" />
        <path d="M193 148 Q200 155 207 148" stroke="#2a2a2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* Raised arms */}
        <path d="M168 165 Q150 140 155 120" stroke="#e8d5c4" strokeWidth="8" strokeLinecap="round" fill="none" />
        <path d="M232 165 Q250 140 245 120" stroke="#e8d5c4" strokeWidth="8" strokeLinecap="round" fill="none" />

        {/* Person 3 - Right */}
        <ellipse cx="310" cy="185" rx="30" ry="20" fill="#3d3d3d" />
        <circle cx="310" cy="150" r="22" fill="#c9b896" />
        <path d="M290 140 Q290 125 310 125 Q330 125 330 140 L332 145 L288 145 Z" fill="#1a1a1a" />
        <circle cx="303" cy="148" r="2" fill="#2a2a2a" />
        <circle cx="317" cy="148" r="2" fill="#2a2a2a" />
        <path d="M305 158 Q310 162 315 158" stroke="#2a2a2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />

        {/* Movie screen at top */}
        <rect x="60" y="20" width="280" height="70" rx="4" fill="#1c1c1c" stroke="#c9a227" strokeWidth="2" />
        <rect x="68" y="28" width="264" height="54" rx="2" fill="url(#movieScreen)" />

        {/* Abstract movie content */}
        <circle cx="150" cy="55" r="18" fill="#c9a227" fillOpacity="0.7" />
        <circle cx="200" cy="50" r="12" fill="#a8505c" fillOpacity="0.6" />
        <rect x="230" y="40" width="80" height="30" rx="4" fill="#c9a227" fillOpacity="0.3" />

        {/* Screen glow effect */}
        <ellipse cx="200" cy="55" rx="150" ry="60" fill="url(#screenGlow)" />

        {/* Floating popcorn pieces */}
        <circle cx="160" cy="110" r="4" fill="#fff8e7" fillOpacity="0.8" />
        <circle cx="180" cy="105" r="3" fill="#fff8e7" fillOpacity="0.6" />
        <circle cx="220" cy="108" r="4" fill="#fff8e7" fillOpacity="0.7" />
        <circle cx="240" cy="115" r="3" fill="#fff8e7" fillOpacity="0.5" />

        {/* Trophy/award element - fantasy league vibe */}
        <g transform="translate(350, 100)">
          <path d="M0 0 L-8 25 L8 25 Z" fill="#c9a227" />
          <circle cx="0" cy="-8" r="12" fill="#c9a227" stroke="#a8851f" strokeWidth="2" />
          <path d="M-4 -10 L0 -14 L4 -10 L0 -6 Z" fill="#fff8e7" />
        </g>

        <defs>
          <radialGradient id="screenGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#c9a227" stopOpacity="0.2" />
            <stop offset="70%" stopColor="#c9a227" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="movieScreen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1a1a2e" />
            <stop offset="50%" stopColor="#0f0f1a" />
            <stop offset="100%" stopColor="#16213e" />
          </linearGradient>
        </defs>
      </svg>
    </Illustration>
  )
}
