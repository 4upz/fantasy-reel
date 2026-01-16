import Illustration, { type IllustrationSize } from './Illustration'

interface Props {
  size?: IllustrationSize
  className?: string
}

export default function TechnicalIssue({ size = 'md', className }: Props): React.ReactElement {
  return (
    <Illustration size={size} alt="Something went wrong" className={className}>
      <svg viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-auto">
        {/* Floor shadow */}
        <ellipse cx="150" cy="185" rx="100" ry="15" fill="#a8505c" fillOpacity="0.1" />

        {/* Broken film projector body */}
        <rect x="100" y="80" width="100" height="80" rx="8" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="2" />

        {/* Projector lens */}
        <circle cx="200" cy="110" r="20" fill="#1c1c1c" stroke="#3a3a3a" strokeWidth="2" />
        <circle cx="200" cy="110" r="12" fill="#2a2a2a" />
        <circle cx="200" cy="110" r="6" fill="#0f0f0f" />

        {/* Top film reels */}
        <circle cx="125" cy="60" r="25" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="2" />
        <circle cx="125" cy="60" r="8" fill="#3a3a3a" />
        <circle cx="175" cy="60" r="25" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="2" />
        <circle cx="175" cy="60" r="8" fill="#3a3a3a" />

        {/* Film reel holes */}
        {[0, 120, 240].map((angle, i) => {
          const rad = (angle * Math.PI) / 180
          return (
            <g key={i}>
              <circle cx={125 + 16 * Math.cos(rad)} cy={60 + 16 * Math.sin(rad)} r="4" fill="#1c1c1c" />
              <circle cx={175 + 16 * Math.cos(rad)} cy={60 + 16 * Math.sin(rad)} r="4" fill="#1c1c1c" />
            </g>
          )
        })}

        {/* Broken film strip - tangled */}
        <path
          d="M140 85 Q130 100 145 110 Q160 120 140 135 Q120 150 150 160"
          stroke="#3a3a3a"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M160 85 Q180 95 165 110 Q150 125 175 140"
          stroke="#3a3a3a"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
        />

        {/* Warning/error indicators */}
        <g transform="translate(230, 60)">
          <polygon points="20,0 40,35 0,35" fill="#a8505c" stroke="#8a4049" strokeWidth="2" />
          <text x="20" y="28" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold" fontFamily="system-ui">!</text>
        </g>

        {/* Sparks/electrical issues */}
        <g stroke="#c9a227" strokeWidth="2" strokeLinecap="round">
          <path d="M85 100 L75 95 L80 105 L70 100" />
          <path d="M90 130 L80 128 L85 135 L75 132" />
        </g>

        {/* Smoke puffs */}
        <circle cx="130" cy="40" r="8" fill="#3a3a3a" fillOpacity="0.5" />
        <circle cx="145" cy="32" r="10" fill="#3a3a3a" fillOpacity="0.4" />
        <circle cx="160" cy="38" r="7" fill="#3a3a3a" fillOpacity="0.3" />
        <circle cx="140" cy="25" r="6" fill="#3a3a3a" fillOpacity="0.2" />

        {/* Projector legs */}
        <rect x="110" y="160" width="10" height="25" rx="2" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="1" />
        <rect x="180" y="160" width="10" height="25" rx="2" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="1" />

        {/* Control knobs */}
        <circle cx="115" cy="140" r="6" fill="#3a3a3a" stroke="#4a4a4a" strokeWidth="1" />
        <circle cx="185" cy="140" r="6" fill="#3a3a3a" stroke="#4a4a4a" strokeWidth="1" />

        {/* Decorative bolts */}
        <circle cx="105" cy="90" r="3" fill="#4a4a4a" />
        <circle cx="195" cy="90" r="3" fill="#4a4a4a" />
        <circle cx="105" cy="150" r="3" fill="#4a4a4a" />
        <circle cx="195" cy="150" r="3" fill="#4a4a4a" />

        {/* Small X marks */}
        <g stroke="#a8505c" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.7">
          <line x1="55" y1="80" x2="65" y2="90" />
          <line x1="65" y1="80" x2="55" y2="90" />
        </g>
      </svg>
    </Illustration>
  )
}
