import { cache } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import GrowthDashboard from './GrowthDashboard'
import type { AdminGrowthStats } from './types'

/**
 * The RPC is the access check: it raises 42501 for anyone not in app_admins.
 * Returns null for them, so the page and its metadata can 404 without
 * advertising that the page exists. Cached so both share one call.
 */
const getGrowthStats = cache(async (): Promise<AdminGrowthStats | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_growth_stats')
  if (error?.code === '42501') return null
  if (error) throw new Error(`admin_growth_stats failed: ${error.message}`)
  return data as AdminGrowthStats
})

export async function generateMetadata(): Promise<Metadata> {
  if (!(await getGrowthStats())) return {}
  return { title: 'Growth', robots: { index: false, follow: false } }
}

export default async function AdminPage() {
  const stats = await getGrowthStats()
  if (!stats) notFound()
  return <GrowthDashboard stats={stats} />
}
