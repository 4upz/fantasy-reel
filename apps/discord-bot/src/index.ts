import { Client, Events, GatewayIntentBits } from 'discord.js'
import http from 'node:http'
import { config } from './config.js'
import { getCommand, registerCommand } from './commands/index.js'
import { setLeague } from './commands/set-league.js'
import { removeLeague } from './commands/remove-league.js'
import { standings } from './commands/standings.js'
import { roster } from './commands/roster.js'
import { configure } from './commands/configure.js'

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

// Register all commands
registerCommand(setLeague)
registerCommand(removeLeague)
registerCommand(standings)
registerCommand(roster)
registerCommand(configure)

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`)
})

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  const command = getCommand(interaction.commandName)
  if (!command) {
    console.warn(`Unknown command: ${interaction.commandName}`)
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
