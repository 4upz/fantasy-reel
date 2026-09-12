const path = require('node:path')

module.exports = {
  testDir: __dirname,
  testMatch: 'trace.spec.cjs',
  outputDir: path.resolve(__dirname, '../../verification/runner'),
  timeout: 10000,
  globalTimeout: 30000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { browserName: 'chromium', trace: 'on' },
}
