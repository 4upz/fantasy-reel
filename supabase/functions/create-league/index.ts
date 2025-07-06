import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface LeagueCreateRequest {
  name: string
  invite_only?: boolean
  draft_start_date?: string
  draft_end_date?: string
  max_participants?: number
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the user from the JWT token
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Parse request body
    const { name, invite_only, draft_start_date, draft_end_date, max_participants }: LeagueCreateRequest = await req.json()

    // Validate required fields
    if (!name || name.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'League name is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Create the league
    const { data: league, error: createError } = await supabaseClient
      .from('leagues')
      .insert({
        name: name.trim(),
        owner_id: user.id,
        invite_only: invite_only || false,
        draft_start_date: draft_start_date || null,
        draft_end_date: draft_end_date || null,
        max_participants: max_participants || 8,
        status: 'setup'
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating league:', createError)
      return new Response(
        JSON.stringify({ error: 'Failed to create league' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    return new Response(
      JSON.stringify({ league }),
      { 
        status: 201, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})