/**
 * The Fantasy Reel bot's Discord application ID: the same value the bot runs
 * with as DISCORD_CLIENT_ID. Unset, there is no install link and the guide
 * shows its instructions without the "Add to Discord" button.
 */
const DISCORD_CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID

/**
 * View Channels (1 << 10) and Manage Webhooks (1 << 29). The bot answers
 * commands through interaction replies, and league updates post through the
 * webhook /set-league creates, so it needs no other permission.
 */
const BOT_PERMISSIONS = (1 << 10) | (1 << 29)

/** Anchor of the bot guide on How to Play (/how-to-play publicly, /help in the app). */
export const DISCORD_GUIDE_ID = 'discord'

/** The public guide link, for pages anyone can see (landing page, header, marketing footer). */
export const DISCORD_GUIDE_HREF = `/how-to-play#${DISCORD_GUIDE_ID}`

/** Server-install link for the bot, or null when the client ID is unset. */
export const DISCORD_BOT_INSTALL_URL = DISCORD_CLIENT_ID
  ? `https://discord.com/oauth2/authorize?${new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      scope: 'bot applications.commands',
      permissions: String(BOT_PERMISSIONS),
      integration_type: '0',
    })}`
  : null

/**
 * A few everyday commands, shown in the in-app guide and on the landing page.
 * The bot's full list appears when you type `/` in Discord.
 */
export const DISCORD_BOT_COMMANDS = [
  { name: '/standings', description: 'League standings' },
  { name: '/my-team', description: 'Your roster, shown only to you' },
  { name: '/roster', description: "Any team's roster" },
  { name: '/movie', description: 'Look up a movie and who owns it' },
  { name: '/upcoming', description: 'Rostered movies releasing soon' },
  { name: '/current-bids', description: 'Movies with active bids' },
]
