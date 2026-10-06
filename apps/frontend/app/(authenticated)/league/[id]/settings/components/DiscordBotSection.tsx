'use client'

import { Bot } from 'lucide-react'
import DiscordBotGuide from '@/app/components/DiscordBotGuide'
import { APP_URL } from '@/utils/appUrl'
import { SectionHeader } from './shared'

interface Props {
  leagueId: string
}

export default function DiscordBotSection({ leagueId }: Props): React.ReactElement {
  return (
    <section className="card p-6">
      <SectionHeader
        icon={Bot}
        title="Discord Bot"
        description="Post league updates to your Discord server"
      />
      <DiscordBotGuide leagueLink={`${APP_URL}/league/${leagueId}`} />
    </section>
  )
}
