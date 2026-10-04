import { formatDate, formatRelativeDate } from '@/utils/date'
import { STATUS_BADGE_CLASS, getStatusLabel } from '@/utils/league'
import { SEASON_YEAR_CLASS } from '@/utils/seasons'
import { count, utcDate } from './format'
import GrowthLineChart from './GrowthLineChart'
import type { AdminGrowthStats, MonthlyGrowth, PeriodCount } from './types'

const PROVIDER_LABEL: Record<string, string> = {
  email: 'Email',
  google: 'Google',
  discord: 'Discord',
}

const HEAD_ROW =
  'type-meta text-left text-foreground-secondary [&>th]:pb-2 [&>th]:font-medium [&>th:not(:last-child)]:pr-4'
const BODY_ROW = 'border-t border-border [&>td]:py-2.5 [&>td:not(:last-child)]:pr-4'

interface FunnelStep {
  label: string
  value: number
}

export default function GrowthDashboard({ stats }: { stats: AdminGrowthStats }) {
  const { users, leagues, rosters, league_funnel, user_funnel, activity } = stats

  const headline = [
    { label: 'Users', value: users.total, note: `+${count(users.new_30d)} in the last 30 days` },
    { label: 'Active in the last 30 days', value: users.active_30d, note: `${count(users.active_7d)} in the last 7 days` },
    { label: 'Leagues', value: leagues.total, note: `+${count(leagues.new_30d)} in the last 30 days` },
    {
      label: 'Movies on rosters',
      value: rosters.holdings,
      note: `${count(rosters.drafted)} drafted, ${count(rosters.picked_up)} picked up`,
    },
  ]

  const activityRows: [string, PeriodCount][] = [
    ['Draft picks', activity.draft_picks],
    ['Pickups won', activity.pickups],
    ['Bids placed', activity.bids],
    ['Counterpicks', activity.counterpicks],
    ['Trades proposed', activity.trades_proposed],
    ['Trades completed', activity.trades_completed],
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="type-page text-foreground">Growth</h1>
          <p className="type-body-sm mt-1 text-foreground-secondary">
            Everyone who has signed up, and how far their leagues got.
          </p>
        </div>
        <p className="type-meta text-foreground-secondary">
          As of {new Date(stats.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
        </p>
      </header>

      {/* The 1px gaps over a border-colored background draw the dividers at every column count. */}
      <dl className="card mb-6 grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-4" data-testid="admin-headline">
        {headline.map((stat) => (
          <div key={stat.label} className="bg-surface p-5">
            <dt className="type-label text-foreground-secondary">{stat.label}</dt>
            <dd className="type-number-lg mt-2 text-foreground">{count(stat.value)}</dd>
            <dd className="type-meta mt-1 text-foreground-secondary">{stat.note}</dd>
          </div>
        ))}
      </dl>

      <section className="card mb-6 p-5" aria-labelledby="admin-growth">
        <h2 id="admin-growth" className="type-panel text-foreground">Growth over time</h2>
        <p className="type-body-sm mt-1 mb-4 text-foreground-secondary">Running totals at the end of each week.</p>
        <GrowthLineChart points={stats.growth} />
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Funnel
          title="Where leagues stall"
          description="Each step counts leagues that reached it or went further, judged on their first season."
          steps={[
            { label: 'Created', value: league_funnel.created },
            { label: 'Invited someone', value: league_funnel.invited },
            { label: 'Got a second player', value: league_funnel.second_player },
            { label: 'Started a draft', value: league_funnel.drafted },
            { label: 'Season underway', value: league_funnel.live },
          ]}
        />
        <Funnel
          title="Where users stall"
          description="Based on the leagues each user is an active member of."
          steps={[
            { label: 'Signed up', value: users.total },
            { label: 'In a league', value: user_funnel.in_league },
            { label: 'In a league with others', value: user_funnel.with_others },
            { label: 'In a league that drafted', value: user_funnel.drafted },
          ]}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <MonthlyBars title="New users by month" months={stats.monthly} field="signups" />
        <MonthlyBars title="New leagues by month" months={stats.monthly} field="leagues" />
      </div>

      <section className="card mb-6 p-5" aria-labelledby="admin-activity">
        <h2 id="admin-activity" className="type-panel text-foreground">Gameplay</h2>
        <table className="mt-4 w-full">
          <thead>
            <tr className={HEAD_ROW}>
              <th>Action</th>
              <th className="text-right">Last 30 days</th>
              <th className="text-right">All time</th>
            </tr>
          </thead>
          <tbody>
            {activityRows.map(([label, period]) => (
              <tr key={label} className={BODY_ROW}>
                <td className="type-body-sm text-foreground">{label}</td>
                <td className="type-number text-right text-foreground">{count(period.last_30d)}</td>
                <td className="type-number text-right text-foreground-secondary">{count(period.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card mb-6 p-5" aria-labelledby="admin-leagues">
        <h2 id="admin-leagues" className="type-panel text-foreground">Newest leagues</h2>
        <div className="-mx-5 mt-4 overflow-x-auto px-5">
          <table className="w-full min-w-[40rem]" data-testid="admin-league-table">
            <thead>
              <tr className={HEAD_ROW}>
                <th>League</th>
                <th>Owner</th>
                <th>Status</th>
                <th className="text-right">Players</th>
                <th>Invite sent</th>
                <th className="text-right">Created</th>
              </tr>
            </thead>
            <tbody>
              {stats.league_list.map((league) => (
                <tr key={league.id} className={BODY_ROW}>
                  <td>
                    <span className="type-row-title text-foreground">{league.name}</span>
                    <span className={`${SEASON_YEAR_CLASS} ml-2 text-foreground-secondary`}>{league.season_year}</span>
                  </td>
                  <td className="type-body-sm text-foreground-secondary">{league.owner ?? 'Unknown'}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE_CLASS[league.status]}`}>{getStatusLabel(league.status)}</span>
                  </td>
                  <td className="type-number text-right text-foreground">
                    {league.players}
                    <span className="text-foreground-secondary"> / {league.max_players}</span>
                  </td>
                  <td className="type-body-sm text-foreground-secondary">{league.invited ? 'Yes' : 'No'}</td>
                  <td className="type-body-sm text-right text-foreground-secondary">{formatDate(league.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5" aria-labelledby="admin-users">
        <h2 id="admin-users" className="type-panel text-foreground">Newest users</h2>
        <div className="-mx-5 mt-4 overflow-x-auto px-5">
          <table className="w-full min-w-[36rem]" data-testid="admin-user-table">
            <thead>
              <tr className={HEAD_ROW}>
                <th>Name</th>
                <th>Signed in with</th>
                <th>Signed up</th>
                <th>Last active</th>
                <th className="text-right">Leagues</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_users.map((user) => (
                <tr key={user.id} className={BODY_ROW}>
                  <td className="type-row-title text-foreground">{user.display_name ?? 'No profile'}</td>
                  <td className="type-body-sm text-foreground-secondary">
                    {user.provider ? PROVIDER_LABEL[user.provider] ?? user.provider : 'Unknown'}
                  </td>
                  <td className="type-body-sm text-foreground-secondary">{formatDate(user.signed_up_at)}</td>
                  <td className="type-body-sm text-foreground-secondary">
                    {user.last_active_at ? formatRelativeDate(user.last_active_at) : 'Never'}
                  </td>
                  <td className="type-number text-right text-foreground">{user.leagues}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Funnel({ title, description, steps }: { title: string; description: string; steps: FunnelStep[] }) {
  const start = steps[0].value

  return (
    <section className="card p-5" aria-label={title}>
      <h2 className="type-panel text-foreground">{title}</h2>
      <p className="type-body-sm mt-1 text-foreground-secondary">{description}</p>
      <ol className="mt-5 space-y-3">
        {steps.map((step) => {
          const share = start > 0 ? step.value / start : 0
          return (
            <li key={step.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5">
              <span className="type-label text-foreground">{step.label}</span>
              <span className="type-number text-foreground">
                {count(step.value)}
                <span className="type-meta ml-2 inline-block w-9 text-right text-foreground-secondary">
                  {Math.round(share * 100)}%
                </span>
              </span>
              <span className="col-span-2 h-2 rounded-full bg-elevated" aria-hidden="true">
                <span
                  className="block h-full rounded-full bg-gold"
                  style={{ width: `${share * 100}%`, minWidth: step.value > 0 ? '0.5rem' : 0 }}
                />
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function MonthlyBars({ title, months, field }: { title: string; months: MonthlyGrowth[]; field: 'signups' | 'leagues' }) {
  const max = Math.max(1, ...months.map((m) => m[field]))
  const total = months.reduce((sum, m) => sum + m[field], 0)

  return (
    <section className="card p-5" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="type-panel text-foreground">{title}</h2>
        <p className="type-meta text-foreground-secondary">
          {count(total)} since {utcDate(months[0].month, { month: 'short', year: 'numeric' })}
        </p>
      </div>
      <ol className="mt-4 flex h-44 items-end gap-1 border-b border-border pt-5">
        {months.map((m) => {
          const value = m[field]
          const label = `${utcDate(m.month, { month: 'long', year: 'numeric' })}: ${count(value)}`
          return (
            <li key={m.month} className="flex h-full flex-1 items-end justify-center" title={label}>
              <span className="sr-only">{label}</span>
              <span
                className="relative w-full max-w-7 rounded-t bg-gold"
                style={{ height: `${(value / max) * 100}%` }}
                aria-hidden="true"
              >
                {value > 0 && (
                  <span className="type-meta absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-foreground-secondary">
                    {value}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      <ol className="mt-2 flex gap-1" aria-hidden="true">
        {months.map((m) => (
          <li key={m.month} className="type-meta flex-1 text-center text-foreground-secondary">
            <span className="sm:hidden">{utcDate(m.month, { month: 'narrow' })}</span>
            <span className="hidden sm:inline">{utcDate(m.month, { month: 'short' })}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
