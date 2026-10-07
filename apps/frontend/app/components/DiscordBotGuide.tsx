import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import DiscordIcon from './icons/DiscordIcon'
import CopyLeagueLink from './CopyLeagueLink'
import { DISCORD_BOT_COMMANDS, DISCORD_BOT_INSTALL_URL } from '@/utils/discordBot'

function SlashCommand({ name }: { name: string }): React.ReactElement {
  return <code className="font-mono text-foreground bg-elevated rounded px-1.5 py-0.5">{name}</code>
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="type-number flex items-center justify-center w-6 h-6 rounded-full bg-gold text-foreground-inverse flex-shrink-0">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-label text-foreground">{title}</p>
        <div className="type-body-sm text-foreground-secondary mt-1">{children}</div>
      </div>
    </li>
  )
}

interface Props {
  /** When set, step 3 shows this league's link with a copy button. */
  leagueLink?: string
}

/**
 * How to add the Fantasy Reel Discord bot: the install link, setup steps, and
 * a few commands. Each caller supplies its own heading.
 */
export default function DiscordBotGuide({ leagueLink }: Props): React.ReactElement {
  return (
    <div className="space-y-6" data-testid="discord-bot-guide">
      {DISCORD_BOT_INSTALL_URL && (
        <a
          href={DISCORD_BOT_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary gap-2"
          data-testid="discord-bot-install-link"
        >
          <DiscordIcon className="w-5 h-5" />
          Add to Discord
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}

      <ol className="space-y-4">
        <Step number={1} title="Add the bot to your server">
          You need the Manage Server permission on that Discord server.
        </Step>
        <Step number={2} title="Connect your Discord account">
          Connect Discord in{' '}
          <Link href="/settings" className="text-gold underline underline-offset-4 hover:text-gold-hover">
            Settings
          </Link>{' '}
          so the bot knows which manager you are.
        </Step>
        <Step number={3} title="Link a channel to your league">
          In the channel where you want league updates, run <SlashCommand name="/set-league" /> and paste
          your league&apos;s link. League owners and anyone with Manage Server can link a channel. Then use{' '}
          <SlashCommand name="/configure" /> to choose which updates post there.
          {leagueLink && <CopyLeagueLink leagueLink={leagueLink} />}
        </Step>
      </ol>

      <div>
        <h3 className="type-label text-foreground mb-3">Commands to try</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {DISCORD_BOT_COMMANDS.map((command) => (
            <li key={command.name} className="rounded-lg bg-surface-hover px-3 py-2.5">
              <code className="type-body-sm font-mono text-gold">{command.name}</code>
              <p className="type-body-sm text-foreground-secondary">{command.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
