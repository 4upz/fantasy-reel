const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { resolve } = require('node:path')

const guide = readFileSync(resolve(__dirname, '../../apps/frontend/app/components/DiscordBotGuide.tsx'), 'utf8')
const commandsDir = resolve(__dirname, '../../apps/discord-bot/src/commands')

// The guide hand-picks commands with shorter descriptions than the bot's, so it
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
  assert.ok(guideCommands.length >= 3, 'expected the guide to name some commands')
  for (const name of guideCommands) {
    assert.ok(botCommands.has(name), `/${name} is not a Discord bot command`)
  }
})
