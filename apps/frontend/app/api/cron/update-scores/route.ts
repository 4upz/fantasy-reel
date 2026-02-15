import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/update-scores`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': process.env.CRON_SECRET || '',
        },
      }
    )

    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return NextResponse.json(
        { error: 'Edge Function returned non-JSON response', status: response.status },
        { status: 502 }
      )
    }

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Cron update-scores failed:', error)
    return NextResponse.json(
      { error: 'Failed to call Edge Function' },
      { status: 502 }
    )
  }
}
