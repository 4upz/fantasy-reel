import BrandLogo from '../BrandLogo'
import DiscordIcon from '../icons/DiscordIcon'
import { DISCORD_BOT_COMMANDS } from '@/utils/discordBot'

/**
 * Discord's slash-command picker, drawn with the bot's real commands.
 * Decorative: the section copy beside it carries the meaning.
 */
export default function DiscordCommandsPreview(): React.ReactElement {
  return (
    <div className="card shadow-glow-gold" aria-hidden="true">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <DiscordIcon className="h-4 w-4 text-[#5865F2]" />
        <span className="type-label text-foreground-secondary"># movie-league</span>
      </div>

      <div className="p-2">
        <p className="type-meta px-2 pb-2 pt-1 text-foreground-secondary">Commands</p>
        <ul>
          {DISCORD_BOT_COMMANDS.slice(0, 4).map((command) => (
            <li key={command.name} className="flex items-center gap-3 rounded-md px-2 py-2 first:bg-surface-hover">
              <BrandLogo markOnly className="h-auto w-6 shrink-0" />
              <div className="min-w-0">
                <p className="type-body-sm font-mono text-foreground">{command.name}</p>
                <p className="type-meta truncate text-foreground-secondary">{command.description}</p>
              </div>
              <span className="type-meta ml-auto hidden shrink-0 text-foreground-secondary sm:inline">Fantasy Reel</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="m-3 mt-1 flex items-center rounded-lg bg-elevated px-3 py-2.5 font-mono text-foreground">
        /<span className="ml-px h-5 w-0.5 bg-gold motion-safe:animate-pulse" />
      </div>
    </div>
  )
}
