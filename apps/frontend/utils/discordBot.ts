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

/** Server-install link for the bot, or null when the client ID is unset. */
export const DISCORD_BOT_INSTALL_URL = DISCORD_CLIENT_ID
  ? `https://discord.com/oauth2/authorize?${new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      scope: 'bot applications.commands',
      permissions: String(BOT_PERMISSIONS),
      integration_type: '0',
    })}`
  : null
