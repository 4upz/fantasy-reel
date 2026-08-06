import { Avatar } from 'fantasy-reel'

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-4">{children}</div>
)

export const Sizes = () => (
  <Row>
    <Avatar name="Alice Spielberg" src={null} size="sm" />
    <Avatar name="Bob Nolan" src={null} size="md" />
    <Avatar name="Carol Coppola" src={null} size="lg" />
  </Row>
)

export const Initials = () => (
  <Row>
    <Avatar name="Alice Spielberg" src={null} />
    <Avatar name="Bob Nolan" src={null} />
    <Avatar name="Carol Coppola" src={null} />
    <Avatar name="Dave Kubrick" src={null} />
  </Row>
)

export const InTeamRow = () => (
  <div className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-border">
    <Avatar name="Carol Coppola" src={null} size="md" />
    <div className="min-w-0">
      <p className="font-display font-semibold text-foreground truncate">Carol Coppola</p>
      <p className="text-sm text-foreground-muted">The Godfathers · 214.5 pts</p>
    </div>
  </div>
)
