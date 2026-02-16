function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

export const config = {
  discordToken: requireEnv('DISCORD_BOT_TOKEN'),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  appUrl: process.env.SITE_URL || process.env.APP_URL || 'https://fantasy-reel.vercel.app',
} as const
