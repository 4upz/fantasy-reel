// Runs before every test file. Command modules import `../config.js` at load
// time (directly or via `utils/embeds.js`), which throws if these env vars
// are missing -- set fakes so imports succeed under vitest.
process.env.DISCORD_BOT_TOKEN ??= 'test-bot-token'
process.env.DISCORD_CLIENT_ID ??= 'test-client-id'
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
process.env.APP_URL ??= 'http://localhost:3000'
