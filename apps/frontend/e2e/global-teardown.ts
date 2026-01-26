import { test as teardown } from '@playwright/test'
import { cleanupTestData } from './helpers/supabase.helper'

/**
 * Global teardown runs after all tests complete
 * Cleans up test data to leave database in clean state
 */
teardown('global teardown', async () => {
  console.log('🧹 Running E2E test teardown...')

  await cleanupTestData()

  console.log('✅ E2E test teardown complete')
})
