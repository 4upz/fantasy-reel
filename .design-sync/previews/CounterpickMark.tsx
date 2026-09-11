import { CounterpickMark, RosterPoster } from 'fantasy-reel'
import { POSTERS } from './_fixtures'

const Example = ({ label = 'Counterpick' }: { label?: string }) => (
  <div className="flex items-center gap-4 p-2">
    <div className="relative w-16 h-24">
      <div className="relative h-full w-full overflow-hidden rounded-lg bg-elevated">
        <RosterPoster movie={{ title: 'Dune: Part Two', poster_url: POSTERS.dune }} sizes="64px" />
      </div>
      <CounterpickMark label={label} />
    </div>
    <div>
      <p className="type-row-title text-foreground">Dune: Part Two</p>
      <p className="type-meta text-foreground-secondary">{label}</p>
    </div>
  </div>
)

export const Default = () => <Example />

export const WithTargetContext = () => <Example label="Counterpick against The Spielbergs" />
