'use client'

interface Props {
  source: 'imdb' | 'rotten_tomatoes' | 'metacritic'
  score: number | null
}

const SOURCE_CONFIG = {
  imdb: {
    label: 'IMDb',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
    bgColor: 'bg-[#f5c518]/10',
    borderColor: 'border-[#f5c518]/30',
    textColor: 'text-[#f5c518]',
    weight: '35%',
  },
  rotten_tomatoes: {
    label: 'RT',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
    bgColor: 'bg-[#fa320a]/10',
    borderColor: 'border-[#fa320a]/30',
    textColor: 'text-[#fa320a]',
    weight: '40%',
  },
  metacritic: {
    label: 'MC',
    icon: (
      <span className="text-[10px] font-bold">MC</span>
    ),
    bgColor: 'bg-[#66cc33]/10',
    borderColor: 'border-[#66cc33]/30',
    textColor: 'text-[#66cc33]',
    weight: '25%',
  },
} as const

export default function ScoreSourceBadge({ source, score }: Props) {
  const config = SOURCE_CONFIG[source]
  const isPending = score == null

  if (isPending) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-elevated border border-border">
          <span className="text-foreground-muted">{config.icon}</span>
          <span className="text-sm font-semibold text-foreground-muted">--</span>
        </div>
        <span className="text-[10px] text-foreground-muted">{config.label}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${config.bgColor} border ${config.borderColor}`}
      >
        <span className={config.textColor}>{config.icon}</span>
        <span className={`text-sm font-semibold ${config.textColor}`}>
          {Math.round(score)}
        </span>
      </div>
      <span className="text-[10px] text-foreground-muted">{config.label}</span>
    </div>
  )
}
