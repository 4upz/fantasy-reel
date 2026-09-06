import { test as teardown } from '@playwright/test'
import { cleanupTestData } from './helpers/supabase.helper'

/**
 * Global teardown runs after all tests complete
 * Cleans up only this run's users, leagues and movies; other runs and manual data remain.
 */
teardown('global teardown', async () => {
  console.log('🧹 Running E2E test teardown...')

  await cleanupTestData()

  console.log('✅ E2E test teardown complete')
})
