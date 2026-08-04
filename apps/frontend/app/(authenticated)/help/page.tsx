import {
  Trophy,
  Users,
  GalleryVerticalEnd,
  CircleDollarSign,
  Handshake,
  Star,
  ArrowRight,
  Film,
  TrendingUp,
  TrendingDown,
  ChevronRight,
} from 'lucide-react'
import Link from 'next/link'

export const metadata = {
  title: 'How to Play | Fantasy Reel',
  description: 'Learn how to play Fantasy Movies - drafting, scoring, pickups, trading, and more.',
}

function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gold-muted text-gold">
          {icon}
        </div>
        <h2 className="text-2xl font-display font-bold text-foreground">{title}</h2>
      </div>
      <div className="space-y-4 text-foreground-secondary">{children}</div>
    </section>
  )
}

function ScoreExample({
  title,
  avgScore,
  bonuses,
  total,
  isPositive,
}: {
  title: string
  avgScore: string
  bonuses: string[]
  total: string
  isPositive: boolean
}) {
  return (
    <div className={`card p-4 border-l-4 ${isPositive ? 'border-l-success' : 'border-l-crimson'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-foreground">{title}</span>
        <span className={`font-display font-bold text-lg ${isPositive ? 'text-success' : 'text-crimson'}`}>
          {total}
        </span>
      </div>
      <div className="text-sm space-y-1">
        <div className="text-foreground-muted">{avgScore}</div>
        {bonuses.map((bonus, i) => (
          <div key={i} className="text-foreground-muted">{bonus}</div>
        ))}
      </div>
    </div>
  )
}

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 lg:py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl lg:text-5xl font-display font-bold text-foreground mb-4">
            How to Play Fantasy Reel
          </h1>
          <p className="text-lg text-foreground-secondary max-w-2xl mx-auto">
            Draft upcoming movies, compete with friends, and earn points based on real critic reviews.
            The manager with the highest-scoring roster wins!
          </p>
        </div>

        {/* Quick Navigation */}
        <nav className="card p-6 mb-12">
          <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-wide mb-4">
            Jump to Section
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { href: '#overview', label: 'Overview', icon: <Film className="w-4 h-4" /> },
              { href: '#leagues', label: 'Leagues', icon: <Users className="w-4 h-4" /> },
              { href: '#drafting', label: 'Drafting', icon: <GalleryVerticalEnd className="w-4 h-4" /> },
              { href: '#scoring', label: 'Scoring', icon: <Trophy className="w-4 h-4" /> },
              { href: '#pickups', label: 'Pickups & Drops', icon: <CircleDollarSign className="w-4 h-4" /> },
              { href: '#trading', label: 'Trading', icon: <Handshake className="w-4 h-4" /> },
            ].map(item => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 p-3 rounded-lg bg-surface hover:bg-surface-hover border border-border hover:border-gold/50 transition-all group"
              >
                <span className="text-gold">{item.icon}</span>
                <span className="text-foreground group-hover:text-gold transition-colors">
                  {item.label}
                </span>
                <ChevronRight className="w-4 h-4 text-foreground-muted ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            ))}
          </div>
        </nav>

        {/* Content Sections */}
        <div className="space-y-16">
          {/* Overview */}
          <Section id="overview" icon={<Film className="w-5 h-5" />} title="What is Fantasy Movies?">
            <p className="text-lg">
              Fantasy Movies works just like fantasy sports, but for films! Instead of drafting athletes,
              you draft upcoming movies. When those movies release and get reviewed by critics, you earn
              fantasy points based on their scores.
            </p>
            <div className="card p-6 bg-surface-hover">
              <h4 className="font-semibold text-foreground mb-3">The Basic Flow</h4>
              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gold text-foreground-inverse text-sm font-bold flex-shrink-0">
                    1
                  </span>
                  <span>Join or create a league with friends</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gold text-foreground-inverse text-sm font-bold flex-shrink-0">
                    2
                  </span>
                  <span>Draft movies you think will be critically acclaimed</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gold text-foreground-inverse text-sm font-bold flex-shrink-0">
                    3
                  </span>
                  <span>Wait for your movies to release and get reviewed</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gold text-foreground-inverse text-sm font-bold flex-shrink-0">
                    4
                  </span>
                  <span>Earn fantasy points based on the Rotten Tomatoes Tomatometer</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gold text-foreground-inverse text-sm font-bold flex-shrink-0">
                    5
                  </span>
                  <span>The manager with the most points at the end wins!</span>
                </li>
              </ol>
            </div>
          </Section>

          {/* Leagues */}
          <Section id="leagues" icon={<Users className="w-5 h-5" />} title="Leagues">
            <p>
              A league is a group of managers (players) competing against each other over a movie season.
              Each league has its own draft, roster settings, and standings.
            </p>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="card p-5">
                <h4 className="font-semibold text-foreground mb-2">Creating a League</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Set a name and configure draft settings</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Choose number of rounds (how many movies each team drafts)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Set a FAAB budget for pickups (optional)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Invite friends via email or share an invite link</span>
                  </li>
                </ul>
              </div>

              <div className="card p-5">
                <h4 className="font-semibold text-foreground mb-2">Joining a League</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Accept an email invitation</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Or use a shared invite link</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Create your team name</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Wait for the league owner to start the draft</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="alert alert-info">
              <p>
                <strong>League Status:</strong> Leagues progress through stages: Setup → Drafting → Active → Completed.
                Different features are available at each stage.
              </p>
            </div>
          </Section>

          {/* Drafting */}
          <Section id="drafting" icon={<GalleryVerticalEnd className="w-5 h-5" />} title="Drafting">
            <p>
              The draft is where you build your roster by selecting movies before they release.
              Each movie can only be drafted by one team in the league.
            </p>

            <div className="card p-5 mb-4">
              <h4 className="font-semibold text-foreground mb-3">Snake Draft Format</h4>
              <p className="text-sm mb-3">
                Most leagues use a &quot;snake&quot; draft, where the pick order reverses each round:
              </p>
              <div className="bg-elevated rounded-lg p-4 font-mono text-sm">
                <div className="text-foreground-muted mb-1">Round 1: Team A → Team B → Team C → Team D</div>
                <div className="text-foreground-muted mb-1">Round 2: Team D → Team C → Team B → Team A</div>
                <div className="text-foreground-muted">Round 3: Team A → Team B → Team C → Team D</div>
              </div>
              <p className="text-sm text-foreground-muted mt-3">
                This ensures fairness - the team that picks last in round 1 picks first in round 2.
              </p>
            </div>

            <div className="card p-5">
              <h4 className="font-semibold text-foreground mb-3">Draft Strategy Tips</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <Star className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Research directors and studios:</strong> Films from acclaimed directors or studios
                    with strong track records tend to review better.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Star className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Consider release timing:</strong> Movies releasing during awards season (Oct-Dec)
                    often aim for critical acclaim.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Star className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Balance risk:</strong> Big blockbusters might be safer picks, but indie films
                    can be sleeper hits with high scores.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Star className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Watch for delays:</strong> Movies can be delayed or moved - check release dates carefully.
                  </span>
                </li>
              </ul>
            </div>

            <div className="card p-5 border-gold/30">
              <h4 className="font-semibold text-foreground mb-3">Counterpick Rounds (Optional)</h4>
              <p className="text-sm">
                Some leagues enable counterpick rounds after the main draft. In counterpick mode, you can assign
                movies from your roster to opponents. If a counterpicked movie scores poorly, your opponent
                takes the hit instead of you!
              </p>
            </div>
          </Section>

          {/* Scoring */}
          <Section id="scoring" icon={<Trophy className="w-5 h-5" />} title="Scoring System">
            <p>
              Fantasy points come from a single number: the <strong>Rotten Tomatoes Tomatometer</strong>.
              The baseline is <strong>60%</strong> - RT&apos;s own &ldquo;Fresh&rdquo; line. Fresh movies earn
              points, rotten movies cost you points, and the 90% Club pays double.
            </p>

            <div className="card p-6 mb-6">
              <h4 className="font-semibold text-foreground mb-4">How Points Are Calculated</h4>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success-bg text-success">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">90%+ - The 90% Club</div>
                    <div className="text-sm">+30 base points + 2 points for each point above 90</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success-bg text-success">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">60-89% - Fresh</div>
                    <div className="text-sm">+1 point for each point above 60</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-error-bg text-error">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">Below 60% - Rotten</div>
                    <div className="text-sm">
                      -1 point for each point below 60. Below 50%, the losses taper off - each 10
                      points deeper costs half as much - bottoming out near -20 points.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <h4 className="font-semibold text-foreground mb-4">Example Scores</h4>
            <div className="grid md:grid-cols-2 gap-4">
              <ScoreExample
                title="The 90% Club"
                avgScore="RT 96%"
                bonuses={['+30 base (90% Club)', '+12 (2 x 6 points above 90)']}
                total="+42 pts"
                isPositive={true}
              />
              <ScoreExample
                title="Certified Crowd-Pleaser"
                avgScore="RT 84%"
                bonuses={['+24 (24 points above the 60% line)']}
                total="+24 pts"
                isPositive={true}
              />
              <ScoreExample
                title="Right at the Line"
                avgScore="RT 60%"
                bonuses={['Exactly at the Fresh baseline']}
                total="0 pts"
                isPositive={true}
              />
              <ScoreExample
                title="Rotten"
                avgScore="RT 35%"
                bonuses={['-15 at 40%, tapering below', 'Losses cap out near -20']}
                total="-16 pts"
                isPositive={false}
              />
            </div>

            <div className="alert alert-warning mt-6">
              <p>
                <strong>Score Source:</strong> Points come from one number, the Rotten Tomatoes
                Tomatometer. 60% is break-even: above it a movie earns points, below it a movie
                loses them. Scores update nightly once a movie is released - a movie without a
                Tomatometer yet shows as Pending.
              </p>
            </div>
          </Section>

          {/* Pickups & Drops */}
          <Section id="pickups" icon={<CircleDollarSign className="w-5 h-5" />} title="Pickups & Drops">
            <p>
              After the draft, you can still acquire new movies through the pickup (waiver) system.
              Use your FAAB budget to bid on undrafted movies.
            </p>

            <div className="card p-5 mb-4">
              <h4 className="font-semibold text-foreground mb-3">FAAB Bidding System</h4>
              <p className="text-sm mb-3">
                <strong>FAAB (Free Agent Acquisition Budget)</strong> is your currency for pickups.
                Each league sets a budget amount (e.g., $100) that you can use throughout the season.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>Place blind bids on available movies</span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>Highest bid wins the movie when the bidding period closes</span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>Winning bid amount is deducted from your FAAB budget</span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>Budget doesn&apos;t reset - spend wisely!</span>
                </li>
              </ul>
            </div>

            <div className="card p-5">
              <h4 className="font-semibold text-foreground mb-3">Dropping Movies</h4>
              <p className="text-sm">
                You can drop movies from your roster to make room for pickups. Dropped movies
                become available for other teams to claim. Consider dropping movies that:
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>Have been indefinitely delayed</span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>Already released with poor scores</span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <span>You need to free up roster space</span>
                </li>
              </ul>
            </div>
          </Section>

          {/* Trading */}
          <Section id="trading" icon={<Handshake className="w-5 h-5" />} title="Trading">
            <p>
              Trade movies with other managers to improve your roster. Both parties must agree
              for a trade to go through.
            </p>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="card p-5">
                <h4 className="font-semibold text-foreground mb-3">Proposing a Trade</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Select movies from your roster to offer</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Select movies you want in return</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span>Send the proposal to the other manager</span>
                  </li>
                </ul>
              </div>

              <div className="card p-5">
                <h4 className="font-semibold text-foreground mb-3">Responding to Trades</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span><strong>Accept:</strong> Trade executes immediately</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span><strong>Reject:</strong> Trade is cancelled</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                    <span><strong>Counter:</strong> Modify and send back</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="alert alert-info">
              <p>
                <strong>League Owner Veto:</strong> League owners can veto trades that appear
                unfair or collusive. Use this power responsibly!
              </p>
            </div>
          </Section>

          {/* CTA */}
          <div className="card p-8 text-center border-gold/30 bg-gradient-to-br from-surface to-gold-muted/10">
            <h3 className="text-2xl font-display font-bold text-foreground mb-3">
              Ready to Play?
            </h3>
            <p className="text-foreground-secondary mb-6 max-w-md mx-auto">
              Create a league and invite your friends, or join an existing league to start drafting movies!
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/dashboard" className="btn btn-primary">
                Go to Dashboard
              </Link>
              <Link href="/movies" className="btn btn-secondary">
                Browse Movies
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
