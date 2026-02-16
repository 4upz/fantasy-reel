import { REST, Routes } from 'discord.js'
import { config } from './config.js'
import { setLeague } from './commands/set-league.js'
import { removeLeague } from './commands/remove-league.js'
import { standings } from './commands/standings.js'
import { roster } from './commands/roster.js'
import { configure } from './commands/configure.js'

const commands = [
  setLeague.data.toJSON(),
  removeLeague.data.toJSON(),
  standings.data.toJSON(),
  roster.data.toJSON(),
  configure.data.toJSON(),
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
