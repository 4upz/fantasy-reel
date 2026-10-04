'use client'

import { toast } from 'sonner'
import { Copy } from 'lucide-react'

/** Read-only league link with a copy button, for pasting into Discord's /set-league. */
export default function CopyLeagueLink({ leagueLink }: { leagueLink: string }): React.ReactElement {
  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(leagueLink)
      toast.success('League link copied')
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="flex items-center gap-3 mt-3">
      <input
        type="text"
        readOnly
        value={leagueLink}
        aria-label="League link"
        className="type-input input w-full min-w-0 text-foreground-secondary truncate cursor-text"
        onClick={(e) => e.currentTarget.select()}
        data-testid="discord-bot-league-link"
      />
      <button
        type="button"
        onClick={copyLink}
        className="btn btn-secondary h-[42px] px-4 shrink-0"
        title="Copy league link"
        aria-label="Copy league link"
      >
        <Copy className="w-5 h-5" />
      </button>
    </div>
  )
}
