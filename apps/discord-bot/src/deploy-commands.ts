import { REST, Routes } from 'discord.js'
import { config } from './config.js'
import { setLeague } from './commands/set-league.js'
import { removeLeague } from './commands/remove-league.js'
import { standings } from './commands/standings.js'
import { roster } from './commands/roster.js'
import { configure } from './commands/configure.js'
import { league } from './commands/league.js'
import { leagueOptions } from './commands/league-options.js'
import { movie } from './commands/movie.js'
import { upcoming } from './commands/upcoming.js'
import { bidResults } from './commands/bid-results.js'
import { currentBids } from './commands/current-bids.js'
import { topAvailable } from './commands/top-available.js'
import { myTeam } from './commands/my-team.js'
import { setBotAdminRole } from './commands/set-bot-admin-role.js'
import { setBidAlertRole } from './commands/set-bid-alert-role.js'

const commands = [
  setLeague.data.toJSON(),
  removeLeague.data.toJSON(),
  standings.data.toJSON(),
  roster.data.toJSON(),
  configure.data.toJSON(),
  league.data.toJSON(),
  leagueOptions.data.toJSON(),
  movie.data.toJSON(),
  upcoming.data.toJSON(),
  bidResults.data.toJSON(),
  currentBids.data.toJSON(),
  topAvailable.data.toJSON(),
  myTeam.data.toJSON(),
  setBotAdminRole.data.toJSON(),
  setBidAlertRole.data.toJSON(),
]

const rest = new REST().setToken(config.discordToken)

async function deploy() {
  try {
    console.log(`Deploying ${commands.length} application commands...`)

    await rest.put(
      Routes.applicationCommands(config.discordClientId),
      { body: commands },
    )

    console.log('Successfully deployed application commands.')
  } catch (error) {
    console.error('Failed to deploy commands:', error)
    process.exit(1)
  }
}

deploy()
