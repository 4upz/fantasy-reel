'use client'

import { useEffect, useRef, useState } from 'react'
import { formatDate } from '@/utils/date'
import { count, utcDate } from './format'
import type { WeeklyGrowth } from './types'

const HEIGHT = 260
const MARGIN = { top: 12, right: 44, bottom: 28, left: 40 }
const MIN_LABEL_GAP = 56
const MIN_END_LABEL_GAP = 14

/** Each series sets currentColor; marks and keys pick it up with stroke/fill/bg-current. */
const SERIES = [
  { key: 'users', label: 'Users', color: 'text-series-1' },
  { key: 'leagues', label: 'Leagues', color: 'text-series-2' },
] as const

/** 0, then even steps of 1/2/5 x 10^n up to at least `max`. */
function yTicks(max: number): number[] {
  const rough = Math.max(max, 1) / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough
  const ticks = [0]
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

/** Two series with a shared count axis: running totals of users and leagues, by week. */
export default function GrowthLineChart({ points }: { points: WeeklyGrowth[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (points.length < 2) {
    return <p className="type-body-sm py-10 text-center text-foreground-secondary">Not enough history for a trend yet.</p>
  }

  const last = points[points.length - 1]
  const first = points[0]
  const ticks = yTicks(Math.max(last.users, last.leagues))
  const yMax = ticks[ticks.length - 1]
  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 0)
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom
  const x = (i: number) => MARGIN.left + (i / (points.length - 1)) * plotW
  const select = (i: number) => setActive(Math.min(Math.max(i, 0), points.length - 1))
  const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH

  // A label at the first week of each month, skipping any that would crowd the previous one.
  const monthLabels: { i: number; text: string }[] = []
  points.forEach((p, i) => {
    const newMonth = i === 0 || p.week.slice(0, 7) !== points[i - 1].week.slice(0, 7)
    const prev = monthLabels[monthLabels.length - 1]
    if (newMonth && (!prev || x(i) - x(prev.i) >= MIN_LABEL_GAP)) {
      const showYear = !prev || p.week.slice(5, 7) === '01'
      monthLabels.push({ i, text: utcDate(p.week, { month: 'short', ...(showYear && { year: 'numeric' }) }) })
    }
  })

  // End labels: nudge apart when the two lines finish close together.
  const endY = SERIES.map((s) => y(last[s.key]))
  if (Math.abs(endY[0] - endY[1]) < MIN_END_LABEL_GAP) {
    const mid = (endY[0] + endY[1]) / 2
    const upper = endY[0] <= endY[1] ? 0 : 1
    endY[upper] = mid - MIN_END_LABEL_GAP / 2
    endY[1 - upper] = mid + MIN_END_LABEL_GAP / 2
  }

  const pointAt = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || plotW === 0) return
    select(Math.round(((clientX - rect.left - MARGIN.left) / plotW) * (points.length - 1)))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = active ?? points.length - 1
    const next =
      e.key === 'ArrowLeft' ? current - 1
      : e.key === 'ArrowRight' ? current + 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? points.length - 1
      : null
    if (next === null) return
    e.preventDefault()
    select(next)
  }

  const hovered = active === null ? null : points[active]
  const summary =
    `Running totals by week since ${formatDate(first.week)}: users grew from ${count(first.users)} to ${count(last.users)}, ` +
    `leagues from ${count(first.leagues)} to ${count(last.leagues)}. Use the arrow keys to read each week.`

  return (
    <div>
      <ul className="mb-3 flex gap-4" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="type-meta flex items-center gap-2 text-foreground-secondary">
            <span className={`h-0.5 w-4 rounded-full bg-current ${s.color}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div
        ref={containerRef}
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-gold"
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="img"
        aria-label={summary}
        onPointerMove={(e) => pointAt(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden="true" className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="type-meta fill-foreground-secondary">
                  {count(t)}
                </text>
              </g>
            ))}
            {monthLabels.map((m) => (
              <text key={m.i} x={x(m.i)} y={HEIGHT - 6} textAnchor="middle" className="type-meta fill-foreground-secondary">
                {m.text}
              </text>
            ))}
            {SERIES.map((s) => (
              <path
                key={s.key}
                d={points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p[s.key])}`).join('')}
                className={`stroke-current ${s.color}`}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {SERIES.map((s, n) => (
              <g key={s.key}>
                <circle cx={x(points.length - 1)} cy={y(last[s.key])} r={4} className={`fill-current stroke-surface ${s.color}`} strokeWidth={2} />
                <text x={x(points.length - 1) + 10} y={endY[n]} dy="0.32em" className="type-number fill-foreground">
                  {count(last[s.key])}
                </text>
              </g>
            ))}
            {hovered && active !== null && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotH} className="stroke-foreground-secondary" strokeWidth={1} />
                {SERIES.map((s) => (
                  <circle key={s.key} cx={x(active)} cy={y(hovered[s.key])} r={4} className={`fill-current stroke-surface ${s.color}`} strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hovered && active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border border-border bg-elevated px-3 py-2 shadow-medium"
            style={
              x(active) > width / 2
                ? { right: width - x(active) + 12 }
                : { left: x(active) + 12 }
            }
            aria-hidden="true"
          >
            <p className="type-meta text-foreground-secondary">Week of {formatDate(hovered.week)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="mt-1 flex items-center gap-2">
                <span className={`h-0.5 w-3 rounded-full bg-current ${s.color}`} aria-hidden="true" />
                <span className="type-number text-foreground">{count(hovered[s.key])}</span>
                <span className="type-meta text-foreground-secondary">{s.label}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {hovered &&
          `Week of ${formatDate(hovered.week)}: ${SERIES.map((s) => `${count(hovered[s.key])} ${s.label.toLowerCase()}`).join(', ')}`}
      </p>
    </div>
  )
}
