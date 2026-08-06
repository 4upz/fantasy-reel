import { TomatometerScore } from 'fantasy-reel'

const Stack = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col items-start gap-3">{children}</div>
)

/** The four readouts the scoring curve produces, top to bottom. */
export const Tiers = () => (
  <Stack>
    <TomatometerScore score={96} />
    <TomatometerScore score={84} />
    <TomatometerScore score={35} />
    <TomatometerScore score={null} />
  </Stack>
)

/** Gold means the movie is earning points; crimson means it is losing them. */
export const AroundTheBaseline = () => (
  <Stack>
    <TomatometerScore score={72} />
    <TomatometerScore score={60} />
    <TomatometerScore score={51} />
  </Stack>
)

export const Sizes = () => (
  <Stack>
    <TomatometerScore score={94} size="sm" />
    <TomatometerScore score={94} size="md" />
    <TomatometerScore score={94} size="lg" />
  </Stack>
)

/** Drop the 90% Club badge where the surface is too narrow to fit it. */
export const WithoutAccolade = () => (
  <Stack>
    <TomatometerScore score={92} showAccolade={false} />
    <TomatometerScore score={92} />
  </Stack>
)

export const OnACard = () => (
  <div className="max-w-sm p-4 rounded-lg bg-surface border border-border">
    <h3 className="font-display font-semibold text-foreground">Dune: Part Two</h3>
    <p className="mt-1 text-sm text-foreground-muted">Released 27 Feb 2024</p>
    <div className="mt-3">
      <TomatometerScore score={92} />
    </div>
  </div>
)
