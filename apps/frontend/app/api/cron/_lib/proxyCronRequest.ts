import { NextResponse } from 'next/server'

/**
 * Shared handler for Vercel Cron routes: validates the `Authorization: Bearer
 * $CRON_SECRET` header Vercel sends, then forwards the request to the named
 * Edge Function with `X-Cron-Secret`, relaying its JSON response.
 */
export async function proxyCronRequest(
  request: Request,
  functionName: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': cronSecret,
        },
        // Headroom under this route's maxDuration=60 so a hung Edge Function
        // doesn't tie up the request indefinitely.
        signal: AbortSignal.timeout(55_000),
        ...(body ? { body: JSON.stringify(body) } : {}),
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
    console.error(
      `Cron ${functionName} failed:`,
      error instanceof Error ? error.name : '',
      error
    )
    return NextResponse.json(
      { error: 'Failed to call Edge Function' },
      { status: 502 }
    )
  }
}
