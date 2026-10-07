import { Client, Events, GatewayIntentBits } from 'discord.js'
import http from 'node:http'
import { config } from './config.js'
import { getCommand, registerCommand } from './commands/index.js'
import { ALL_COMMANDS } from './commands/all.js'
import { autocompleteDebouncer, autocompleteLimiter, commandLimiter } from './utils/cooldown.js'

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

ALL_COMMANDS.forEach(registerCommand)

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`)
})

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = getCommand(interaction.commandName)
    if (!command?.autocomplete) return

    // Only the user's latest keystroke gets a search; older ones get no choices.
    const key = `${interaction.user.id}:${interaction.commandName}`
    if (!(await autocompleteDebouncer.settle(key)) || autocompleteLimiter.consume(key) > 0) {
      await interaction.respond([]).catch(() => {})
      return
    }

    try {
      await command.autocomplete(interaction)
    } catch (error) {
      console.error(`Error in autocomplete for /${interaction.commandName}:`, error)
      await interaction.respond([]).catch(() => {})
    }
    return
  }

  if (!interaction.isChatInputCommand()) return

  const command = getCommand(interaction.commandName)
  if (!command) {
    console.warn(`Unknown command: ${interaction.commandName}`)
    return
  }

  const waitMs = commandLimiter.consume(interaction.user.id)
  if (waitMs > 0) {
    const seconds = Math.ceil(waitMs / 1000)
    await interaction
      .reply({ content: `You're using commands too quickly. Try again in ${seconds}s.`, ephemeral: true })
      .catch(console.error)
    return
  }

  try {
    await command.execute(interaction)
  } catch (error) {
    console.error(`Error executing /${interaction.commandName}:`, error)
    const message = 'Something went wrong. Please try again.'
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(message).catch(console.error)
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(console.error)
    }
  }
})

// Health check HTTP server
const healthServer = http.createServer((_req, res) => {
  const ready = client.isReady()
  res.writeHead(ready ? 200 : 503)
  res.end(ready ? 'OK' : 'Not connected')
})

healthServer.listen(3001, () => {
  console.log('Health check server listening on port 3001')
})

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...')
  client.destroy()
  healthServer.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

client.login(config.discordToken)
