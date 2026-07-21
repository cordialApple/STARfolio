import { spawnSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import electron from 'electron'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')

// better-sqlite3 is a native addon with no ABI-stable N-API build: `npm ci`
// leaves it built for Node's ABI, but running the app (rebuild:electron) swaps
// it to Electron's. Probe which ABI the currently-built binary matches and run
// vitest under whichever runtime can load it, so tests pass in both states.
function loadsUnderNode() {
  return (
    spawnSync(process.execPath, ['-e', "new (require('better-sqlite3'))(':memory:').close()"], {
      cwd: root,
      stdio: 'ignore'
    }).status === 0
  )
}

const underNode = loadsUnderNode()
const bin = underNode ? process.execPath : electron
const env = underNode ? process.env : { ...process.env, ELECTRON_RUN_AS_NODE: '1' }

const res = spawnSync(bin, [vitest, 'run', ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: 'inherit'
})
process.exit(res.status ?? 1)
