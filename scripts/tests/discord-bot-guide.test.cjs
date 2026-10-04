const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { resolve } = require('node:path')

const frontend = resolve(__dirname, '../../apps/frontend')
// The highlighted commands live in utils/discordBot.ts; the guide's setup steps name more inline.
const guide = ['app/components/DiscordBotGuide.tsx', 'utils/discordBot.ts']
  .map((file) => readFileSync(resolve(frontend, file), 'utf8'))
  .join('\n')
const commandsDir = resolve(__dirname, '../../apps/discord-bot/src/commands')

// The app hand-picks commands with shorter descriptions than the bot's, so it
// can't import the bot's list -- but every name it shows must still exist there.
const botCommands = new Set(
  readdirSync(commandsDir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) => [
      ...readFileSync(resolve(commandsDir, file), 'utf8').matchAll(/new SlashCommandBuilder\(\)\s*\.setName\('([a-z-]+)'\)/g),
    ])
    .map((match) => match[1])
)

const guideCommands = [...guide.matchAll(/name(?:=|: )["']\/([a-z-]+)["']/g)].map((match) => match[1])

test('the bot command list is readable', () => {
  assert.ok(botCommands.has('set-league'), 'expected to find /set-league among the bot commands')
})

test('every command the Discord bot guide names exists in the bot', () => {
  // One name from each file, so a moved list fails loudly instead of checking nothing.
  assert.ok(guideCommands.includes('set-league') && guideCommands.includes('standings'), 'expected commands from both files')
  for (const name of guideCommands) {
    assert.ok(botCommands.has(name), `/${name} is not a Discord bot command`)
  }
})
