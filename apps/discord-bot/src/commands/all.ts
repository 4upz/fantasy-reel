import { setLeague } from './set-league.js'
import { removeLeague } from './remove-league.js'
import { standings } from './standings.js'
import { roster } from './roster.js'
import { configure } from './configure.js'
import { league } from './league.js'
import { leagueOptions } from './league-options.js'
import { movie } from './movie.js'
import { upcoming } from './upcoming.js'
import { bidResults } from './bid-results.js'
import { currentBids } from './current-bids.js'
import { topAvailable } from './top-available.js'
import { myTeam } from './my-team.js'
import { setBotAdminRole } from './set-bot-admin-role.js'
import { setBidAlertRole } from './set-bid-alert-role.js'
import type { Command } from './index.js'

/**
 * Every slash command the bot serves. Both the gateway process (index.ts) and
 * the deploy script (deploy-commands.ts) read this one list, so a new command
 * can't be handled at runtime but missing from Discord, or vice versa.
 */
export const ALL_COMMANDS: Command[] = [
  setLeague,
  removeLeague,
  standings,
  roster,
  configure,
  league,
  leagueOptions,
  movie,
  upcoming,
  bidResults,
  currentBids,
  topAvailable,
  myTeam,
  setBotAdminRole,
  setBidAlertRole,
]
