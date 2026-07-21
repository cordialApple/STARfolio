import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { getPrefs, type Prefs } from '../settings/prefs'
import {
  mapPrefsToConfig,
  buildConfigJson,
  writeConfigAtomic,
  type ConfigFs
} from './personalserver-config'

const realFs: ConfigFs = {
  exists: existsSync,
  read: (p) => readFileSync(p, 'utf8'),
  write: (p, data) => writeFileSync(p, data, { encoding: 'utf8', mode: 0o600 }),
  rename: renameSync,
  mkdir: (dir) => mkdirSync(dir, { recursive: true })
}

function personalServerConfigPath(): string {
  if (process.env.PERSONALSERVER_CONFIG_FILE) return process.env.PERSONALSERVER_CONFIG_FILE
  const home = app.getPath('home')
  let dir: string
  if (process.platform === 'win32') {
    dir = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  } else if (process.platform === 'darwin') {
    dir = join(home, 'Library', 'Application Support')
  } else {
    dir = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share')
  }
  return join(dir, 'PersonalServer', 'config.json')
}

export function syncPersonalServerConfig(prefs: Prefs = getPrefs(), fs: ConfigFs = realFs): void {
  try {
    const dbPath = join(app.getPath('userData'), 'superstar.db')
    const config = mapPrefsToConfig(prefs, dbPath)
    const filePath = personalServerConfigPath()
    const prevRaw = fs.exists(filePath) ? fs.read(filePath) : null
    writeConfigAtomic(fs, filePath, buildConfigJson(prevRaw, config, new Date().toISOString()))
  } catch (err) {
    console.warn('[personalserver-config] write skipped:', (err as Error).message)
  }
}
