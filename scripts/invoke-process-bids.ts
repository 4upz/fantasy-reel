#!/usr/bin/env -S deno run --allow-all
/**
 * Manual Invocation Script for process-bids Edge Function
 *
 * Easily call the process-bids Edge Function locally or in production
 * with automatic environment variable loading.
 *
 * Usage:
 *   # Local run (weekly mode, all leagues)
 *   deno run --allow-all scripts/invoke-process-bids.ts
 *
 *   # Local run for specific league in extended mode
 *   deno run --allow-all scripts/invoke-process-bids.ts -l <league_id> -m extended
 *
 *   # Production run for specific league
 *   deno run --allow-all scripts/invoke-process-bids.ts -p -l <league_id>
 */

import { parseArgs } from "jsr:@std/cli/parse-args"
import { load } from "jsr:@std/dotenv"

// Load local environment variables from workspace root .env.local if present,
// and supabase/functions/.env.test
await load({ export: true, envPath: ".env.local" })
await load({ export: true, envPath: "supabase/functions/.env.test" })

const args = parseArgs(Deno.args, {
  string: ["league", "mode", "url", "secret", "key"],
  boolean: ["help", "prod"],
  alias: {
    l: "league",
    m: "mode",
    u: "url",
    s: "secret",
    k: "key",
    h: "help",
    p: "prod"
  },
  default: {
    mode: "weekly"
  }
})

if (args.help) {
  console.log(`
Usage:
  deno run --allow-all scripts/invoke-process-bids.ts [options]

Options:
  -l, --league <id>   Filter processing to a specific league ID (optional)
  -m, --mode <mode>   Processing mode: 'weekly' (default) or 'extended'
  -p, --prod          Point to the production project (uses production env vars)
  -u, --url <url>     Override Supabase URL
  -s, --secret <sec>  Override X-Cron-Secret header
  -k, --key <key>     Override Authorization Bearer service role key
  -h, --help          Show this help message
`)
  Deno.exit(0)
}

// 1. Resolve Supabase URL
let supabaseUrl = args.url
if (!supabaseUrl) {
  if (args.prod) {
    // If prod, prioritize SUPABASE_PROJECT_REF
    const projectRef = Deno.env.get("SUPABASE_PROJECT_REF")
    if (projectRef) {
      supabaseUrl = `https://${projectRef}.supabase.co`
    } else {
      supabaseUrl = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL")
      const envUrl = Deno.env.get("SUPABASE_URL")
      // Only use SUPABASE_URL if it is a remote production URL (not local)
      if (envUrl && !envUrl.includes("127.0.0.1") && !envUrl.includes("localhost")) {
        supabaseUrl = envUrl
      }
    }
  } else {
    // Local default
    supabaseUrl = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321"
  }
}

if (!supabaseUrl) {
  console.error("❌ Error: Supabase URL not found. Please provide -u or set SUPABASE_URL in your environment.")
  Deno.exit(1)
}

// 2. Resolve authentication keys (Cron Secret or Service Role Key)
const cronSecret = args.secret || Deno.env.get("CRON_SECRET")
let serviceRoleKey = args.key || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

// If pointing locally and no key/secret was explicitly provided, try to query the Docker container
// for the service role key that the Edge Function runtime actually uses.
if (!args.prod && !args.key && !args.secret) {
  try {
    const cmd = new Deno.Command("docker", {
      args: ["exec", "supabase_edge_runtime_fantasy-reel", "printenv", "SUPABASE_SERVICE_ROLE_KEY"],
      stdout: "piped",
      stderr: "piped",
    })
    const output = await cmd.output()
    if (output.success) {
      const dockerKey = new TextDecoder().decode(output.stdout).trim()
      if (dockerKey) {
        serviceRoleKey = dockerKey
      }
    }
  } catch {
    // Fall back to env var if docker not available
  }
}

if (!cronSecret && !serviceRoleKey) {
  console.error("❌ Error: No authentication method found. Please set CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY.")
  Deno.exit(1)
}

const functionUrl = `${supabaseUrl}/functions/v1/process-bids`

console.log(`\n🚀 Invoking process-bids Edge Function...`)
console.log(`📍 URL:        ${functionUrl}`)
console.log(`⚙️ Mode:       ${args.mode}`)
if (args.league) {
  console.log(`🏆 League ID:  ${args.league}`)
} else {
  console.log(`🏆 League ID:  [All Leagues]`)
}

// Build headers
const headers: Record<string, string> = {
  "Content-Type": "application/json",
}

if (cronSecret) {
  headers["X-Cron-Secret"] = cronSecret
  console.log(`🔐 Auth:       Using X-Cron-Secret`)
} else if (serviceRoleKey) {
  headers["Authorization"] = `Bearer ${serviceRoleKey}`
  console.log(`🔐 Auth:       Using Service Role Key`)
}

// Build body
const body = {
  mode: args.mode,
  league_id: args.league,
}

try {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const text = await response.text()
  console.log(`\n📬 Response Code: ${response.status} ${response.statusText}`)
  
  try {
    const json = JSON.parse(text)
    console.log("📄 Payload:")
    console.log(JSON.stringify(json, null, 2))
  } catch {
    console.log("📄 Response (Plain Text):")
    console.log(text)
  }
} catch (error) {
  console.error(`❌ Fetch request failed:`, error)
}
