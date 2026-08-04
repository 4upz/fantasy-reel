import { REST, Routes } from 'discord.js'
import { config } from './config.js'
import { ALL_COMMANDS } from './commands/all.js'

const commands = ALL_COMMANDS.map((command) => command.data.toJSON())

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
