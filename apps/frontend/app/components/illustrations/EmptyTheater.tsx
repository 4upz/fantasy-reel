import Illustration, { type IllustrationSize } from './Illustration'

interface Props {
  size?: IllustrationSize
  className?: string
}

export default function EmptyTheater({ size = 'md', className }: Props): React.ReactElement {
  return (
    <Illustration size={size} alt="Empty theater waiting for you" className={className}>
      <svg viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-auto">
        {/* Floor shadow */}
        <ellipse cx="150" cy="185" rx="120" ry="15" fill="#c9a227" fillOpacity="0.08" />

        {/* Back row of seats */}
        <g transform="translate(0, 0)">
          {[30, 80, 130, 180, 230].map((x, i) => (
            <g key={i}>
              <rect x={x} y="60" width="35" height="30" rx="4" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="1.5" />
              <rect x={x + 3} y="55" width="29" height="8" rx="3" fill="#3a3a3a" />
            </g>
          ))}
        </g>

        {/* Middle row of seats */}
        <g transform="translate(10, 45)">
          {[30, 85, 140, 195].map((x, i) => (
            <g key={i}>
              <rect x={x} y="60" width="40" height="35" rx="4" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="1.5" />
              <rect x={x + 4} y="54" width="32" height="10" rx="4" fill="#3a3a3a" />
            </g>
          ))}
        </g>

        {/* Front row - center seat highlighted */}
        <g transform="translate(20, 95)">
          {[20, 85, 150, 215].map((x, i) => (
            <g key={i}>
              <rect
                x={x}
                y="60"
                width="45"
                height="40"
                rx="5"
                fill={i === 1 ? '#3d3530' : '#2a2a2a'}
                stroke={i === 1 ? '#c9a227' : '#3a3a3a'}
                strokeWidth={i === 1 ? 2 : 1.5}
              />
              <rect x={x + 5} y="53" width="35" height="12" rx="5" fill={i === 1 ? '#4a4035' : '#3a3a3a'} />
              {i === 1 && (
                <>
                  {/* Sparkle on highlighted seat */}
                  <circle cx={x + 22} cy="50" r="3" fill="#c9a227" fillOpacity="0.8" />
                  <circle cx={x + 35} cy="58" r="2" fill="#c9a227" fillOpacity="0.5" />
                  <circle cx={x + 10} cy="55" r="2" fill="#c9a227" fillOpacity="0.6" />
                </>
              )}
            </g>
          ))}
        </g>

        {/* Screen at top */}
        <rect x="40" y="10" width="220" height="35" rx="3" fill="#1c1c1c" stroke="#3a3a3a" strokeWidth="1.5" />
        <rect x="48" y="16" width="204" height="23" rx="2" fill="url(#emptyScreenGradient)" />

        {/* "Your seat awaits" text area on screen */}
        <text x="150" y="32" textAnchor="middle" fill="#c9a227" fillOpacity="0.6" fontSize="10" fontFamily="system-ui">
          Your league awaits
        </text>

        {/* Decorative film strip on sides */}
        <g transform="translate(8, 40)">
          {[0, 20, 40, 60, 80].map((y, i) => (
            <rect key={i} x="0" y={y} width="8" height="15" rx="1" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="0.5" />
          ))}
        </g>
        <g transform="translate(284, 40)">
          {[0, 20, 40, 60, 80].map((y, i) => (
            <rect key={i} x="0" y={y} width="8" height="15" rx="1" fill="#2a2a2a" stroke="#3a3a3a" strokeWidth="0.5" />
          ))}
        </g>

        {/* Subtle spotlight effect */}
        <ellipse cx="150" cy="130" rx="60" ry="40" fill="url(#spotlightGlow)" />

        <defs>
          <radialGradient id="spotlightGlow" cx="0.5" cy="0.3" r="0.7">
            <stop offset="0%" stopColor="#c9a227" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="emptyScreenGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a1a2e" />
            <stop offset="100%" stopColor="#0f0f1a" />
          </linearGradient>
        </defs>
      </svg>
    </Illustration>
  )
}
