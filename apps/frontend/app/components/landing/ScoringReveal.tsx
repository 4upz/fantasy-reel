import Image from 'next/image'
import { SCORING_EXAMPLES, type ScoringExample } from './data'

interface ScoringCardProps {
  example: ScoringExample
  variant: 'winner' | 'loser'
  className?: string
}

function ScoringCard({ example, variant, className = '' }: ScoringCardProps): React.ReactElement {
  const valueClass = variant === 'winner' ? 'good' : 'bad'
  const pointsClass = variant === 'winner' ? 'positive' : 'negative'
  const pointsPrefix = example.fantasyPoints > 0 ? '+' : ''

  return (
    <div className={`scoring-card ${variant} animate-fade-in ${className}`}>
      <Image
        src={example.posterUrl}
        alt={example.title}
        width={180}
        height={270}
        className="scoring-poster"
      />

      <div className="scoring-tomatometer">
        <div className="tomatometer-reading">
          <span className="tomatometer-icon" aria-hidden="true">🍅</span>
          <span className={`tomatometer-value ${valueClass}`}>{example.tomatometer}%</span>
        </div>
        <span className="tomatometer-label">
          Tomatometer &middot; {example.tomatometer >= 60 ? 'Fresh' : 'Rotten'}
        </span>
      </div>

      <div className="scoring-result">
        <p className="text-foreground-muted text-sm">Drafted at ${example.draftPrice}</p>
        <p className={`scoring-points ${pointsClass}`}>
          {pointsPrefix}{example.fantasyPoints} pts
        </p>
        <p className="scoring-quote">
          &ldquo;{example.quote}&rdquo;{' '}
          <span className="scoring-quote-author">— {example.quoter}</span>
        </p>
      </div>
    </div>
  )
}

/** @design-system Landing */
export default function ScoringReveal(): React.ReactElement {
  const winner = SCORING_EXAMPLES.find((e) => e.isWinner)!
  const loser = SCORING_EXAMPLES.find((e) => !e.isWinner)!

  return (
    <section className="scoring-spotlight py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="font-display text-3xl md:text-4xl font-bold text-center text-foreground mb-4">
          The Critics Have Spoken
        </h2>
        <p className="text-foreground-secondary text-center mb-16 max-w-2xl mx-auto">
          Your score comes straight from the Rotten Tomatoes Tomatometer. Pick
          acclaimed hits, you win. Pick confident flops, you get roasted in the
          group chat.
        </p>

        <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
          <ScoringCard example={winner} variant="winner" />
          <ScoringCard example={loser} variant="loser" className="stagger-2" />
        </div>

        <p className="text-center text-foreground-muted mt-12 max-w-xl mx-auto">
          No complex math. No spreadsheets. Just taste.
        </p>
      </div>
    </section>
  )
}
