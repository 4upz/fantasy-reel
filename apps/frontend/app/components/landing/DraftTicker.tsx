'use client'

import Image from 'next/image'
import type { TickerEntry } from './data'

interface Props {
  entries: TickerEntry[]
}

/** @design-system Landing */
export default function DraftTicker({ entries }: Props): React.ReactElement {
  // Duplicate entries for seamless infinite scroll
  const duplicatedEntries = [...entries, ...entries]

  return (
    <div className="ticker-container">
      <div className="ticker-track">
        {duplicatedEntries.map((entry, index) => (
          <div key={`${entry.movie.title}-${index}`} className="ticker-item">
            {entry.movie.posterUrl && (
              <Image
                src={entry.movie.posterUrl}
                alt={entry.movie.title}
                width={40}
                height={60}
                className="ticker-poster"
              />
            )}
            <span className="ticker-handle">{entry.user.handle}</span>
            <span className="ticker-action">{entry.action}</span>
            <span className="ticker-movie">&ldquo;{entry.movie.title}&rdquo;</span>
            <span className="ticker-snark">→ &ldquo;{entry.comment}&rdquo;</span>
          </div>
        ))}
      </div>
    </div>
  )
}
