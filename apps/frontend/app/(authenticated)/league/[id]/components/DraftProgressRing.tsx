'use client'

import { CheckIcon } from './Icons'

interface Props {
  current: number
  total: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

const SIZES = {
  sm: { ring: 48, stroke: 4, text: 'text-xs' },
  md: { ring: 64, stroke: 5, text: 'text-sm' },
  lg: { ring: 80, stroke: 6, text: 'text-base' },
}

export default function DraftProgressRing({
  current,
  total,
  size = 'md',
  showLabel = true,
}: Props) {
  const { ring, stroke, text } = SIZES[size]
  const radius = (ring - stroke) / 2
  const circumference = radius * 2 * Math.PI
  const progress = total > 0 ? current / total : 0
  const offset = circumference - progress * circumference

  const percentage = Math.round(progress * 100)
  const isComplete = current >= total

  return (
    <div className="flex flex-col items-center gap-2" data-testid="draft-progress">
      <div className="relative" style={{ width: ring, height: ring }}>
        {/* Background Ring */}
        <svg className="transform -rotate-90" width={ring} height={ring}>
          <circle
            cx={ring / 2}
            cy={ring / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-border"
          />
          {/* Progress Ring */}
          <circle
            cx={ring / 2}
            cy={ring / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`transition-all duration-500 ease-out ${
              isComplete ? 'text-success' : 'text-gold'
            }`}
          />
        </svg>

        {/* Center Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display font-bold ${text} ${isComplete ? 'text-success' : 'text-foreground'}`}>
            {percentage}%
          </span>
        </div>

        {/* Completion Checkmark */}
        {isComplete && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-success rounded-full flex items-center justify-center shadow-md animate-fade-in">
            <CheckIcon className="w-3 h-3 text-background" />
          </div>
        )}
      </div>

      {showLabel && (
        <div className="text-center">
          <p className={`${text} text-foreground-secondary`}>
            <span className="font-medium text-foreground">{current}</span>
            <span className="mx-1">/</span>
            <span>{total}</span>
            <span className="ml-1">picks</span>
          </p>
        </div>
      )}
    </div>
  )
}
