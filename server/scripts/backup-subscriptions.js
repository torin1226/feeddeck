/**
 * backup-subscriptions.js
 *
 * CLI tool to back up creator/following lists from social platforms.
 *
 * Usage:
 *   node server/scripts/backup-subscriptions.js                          # all platforms with auth
 *   node server/scripts/backup-subscriptions.js --platform twitter       # one platform
 *   node server/scripts/backup-subscriptions.js --platform tiktok --gdpr-path ./export
 *   node server/scripts/backup-subscriptions.js --sync                   # also import to creators table
 *   node server/scripts/backup-subscriptions.js --export backup.json     # JSON export
 *   node server/scripts/backup-subscriptions.js --status                 # check auth availability
 */

import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync } from 'fs'

// Init database before importing backup module
const __dirname = dirname(fileURLToPath(import.meta.url))
process.chdir(resolve(__dirname, '../..'))

const { initDatabase } = await import('../database.js')
initDatabase()

const {
  backupPlatform,
  backupAll,
  getBackupStatus,
  getBackedUpSubscriptions,
  syncToCreators,
} = await import('../subscription-backup.js')

// Parse CLI args
const args = process.argv.slice(2)
const flags = {}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--platform' && args[i + 1]) flags.platform = args[++i]
  else if (args[i] === '--gdpr-path' && args[i + 1]) flags.gdprPath = resolve(args[++i])
  else if (args[i] === '--export' && args[i + 1]) flags.exportPath = resolve(args[++i])
  else if (args[i] === '--sync') flags.sync = true
  else if (args[i] === '--status') flags.status = true
  else if (args[i] === '--help' || args[i] === '-h') { printHelp(); process.exit(0) }
}

function printHelp() {
  console.log(`
Subscription Backup Tool

Usage:
  node server/scripts/backup-subscriptions.js [options]

Options:
  --platform <name>    Back up a specific platform (youtube, twitter, reddit, tiktok, instagram)
  --gdpr-path <path>   Path to GDPR export folder (required for tiktok, instagram)
  --sync               Also import backed-up subscriptions into creators table
  --export <file>      Export results to JSON file
  --status             Show which platforms have auth available
  --help               Show this help
`)
}

async function main() {
  // Status check
  if (flags.status) {
    const status = getBackupStatus()
    console.log('\nPlatform Auth Status:')
    for (const [platform, s] of Object.entries(status)) {
      const icon = s.available ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
      console.log(`  ${icon} ${platform.padEnd(12)} ${s.reason}`)
    }
    process.exit(0)
  }

  const options = {}
  if (flags.gdprPath) options.gdprPath = flags.gdprPath

  let results
  if (flags.platform) {
    console.log(`\nBacking up ${flags.platform}...`)
    try {
      const result = await backupPlatform(flags.platform, options)
      results = { [flags.platform]: result }
      console.log(`  ✓ ${result.count} subscriptions backed up`)
    } catch (err) {
      console.error(`  ✗ ${err.message}`)
      process.exit(1)
    }
  } else {
    console.log('\nBacking up all platforms with available auth...')
    results = await backupAll(options)
    for (const [platform, result] of Object.entries(results)) {
      if (result.skipped) {
        console.log(`  - ${platform.padEnd(12)} skipped (${result.reason})`)
      } else if (result.error) {
        console.log(`  \x1b[31m✗\x1b[0m ${platform.padEnd(12)} ${result.error}`)
      } else {
        console.log(`  \x1b[32m✓\x1b[0m ${platform.padEnd(12)} ${result.count} subscriptions`)
      }
    }
  }

  // Sync to creators
  if (flags.sync) {
    console.log('\nSyncing to creators table...')
    const syncResult = syncToCreators(flags.platform)
    console.log(`  ✓ ${syncResult.added} new creators added (${syncResult.total} total checked)`)
  }

  // Export
  if (flags.exportPath) {
    const all = getBackedUpSubscriptions(flags.platform)
    writeFileSync(flags.exportPath, JSON.stringify(all, null, 2))
    console.log(`\n✓ Exported ${all.length} subscriptions to ${flags.exportPath}`)
  }

  // Summary
  const all = getBackedUpSubscriptions()
  const counts = {}
  for (const s of all) counts[s.platform] = (counts[s.platform] || 0) + 1
  console.log('\nTotal backed up:')
  for (const [p, c] of Object.entries(counts).sort()) {
    console.log(`  ${p.padEnd(12)} ${c}`)
  }
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
