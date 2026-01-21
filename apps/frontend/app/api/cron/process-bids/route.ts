import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(request: Request) {
  // Verify this is a Vercel cron request
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Determine mode from URL params
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode') || 'weekly'

  // Call the Edge Function
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-bids`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': process.env.CRON_SECRET || '',
      },
      body: JSON.stringify({ mode }),
    }
  )

  const data = await response.json()

  return NextResponse.json(data)
}
