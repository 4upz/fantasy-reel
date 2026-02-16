import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey)
  }
  return client
}
