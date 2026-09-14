'use client'

import { useState } from 'react'
import Image from 'next/image'
import { TomatoMark } from '../TomatometerScore'
import { EXAMPLE_MOVIES } from './example-movies'
import styles from './HeroMovieLineup.module.css'

export default function HeroMovieLineup() {
  const [selectedIndex, setSelectedIndex] = useState(1)
  const selectedMovie = EXAMPLE_MOVIES[selectedIndex]

  return (
    <figure
      className={styles.lineup}
      aria-label="Example movies from 2026 with Rotten Tomatoes critic scores"
      data-testid="hero-movie-lineup"
    >
      <div className={styles.posters}>
        {EXAMPLE_MOVIES.map((movie, index) => (
          <button
            key={movie.poster}
            type="button"
            className={styles.movie}
            aria-label={`${movie.title}, ${movie.tomatometer}% Rotten Tomatoes critic score`}
            aria-pressed={selectedIndex === index}
            onClick={() => setSelectedIndex(index)}
            data-testid={`hero-movie-${movie.poster}`}
          >
            <Image
              src={`/images/homepage/${movie.poster}.webp`}
              alt=""
              width={260}
              height={390}
              unoptimized
              loading="eager"
            />
            <span className={`type-numeric ${styles.score}`} aria-hidden="true">
              <TomatoMark fill={movie.tomatometer} className={styles.tomato} />
              {movie.tomatometer}%
            </span>
          </button>
        ))}
      </div>
      <figcaption className={`type-meta ${styles.caption}`} aria-live="polite" aria-atomic="true">
        <a href={selectedMovie.source} target="_blank" rel="noopener noreferrer">
          {selectedMovie.title}
          <span className="sr-only"> — Rotten Tomatoes score for this 2026 example (opens in a new tab)</span>
        </a>
      </figcaption>
    </figure>
  )
}
