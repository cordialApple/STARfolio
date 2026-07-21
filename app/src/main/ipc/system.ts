import { app, type IpcMain } from 'electron'
import { handle, saveDialog, runVaultSync, type IpcHooks } from './shared'
import { getPrefs, setPrefs, staleness, prefsPatch } from '../settings/prefs'
import { usageSummary } from '../ai/usage'
import { dbSelfTest } from '../db/selftest'
import { getModelStatus } from '../embed'
import { embedSelfTest } from '../embed/selftest'
import { checkForUpdate, downloadUpdate, quitAndInstall, updateStatus } from '../updater'
import { backupTo } from '../db/migrate'

export function registerSystem(ipcMain: IpcMain, hooks: IpcHooks): void {
  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('prefs:get', () => getPrefs())
  handle(ipcMain, 'prefs:set', prefsPatch, async (_e, patch) => {
    const next = setPrefs(patch)
    hooks.onPrefsChange?.(next)
    if (patch.storageMode !== undefined && next.vaultPath) await runVaultSync(next.vaultPath)
    return next
  })
  ipcMain.handle('nudge:staleness', () => staleness())
  ipcMain.handle('usage:summary', () => usageSummary())
  ipcMain.handle('db:selfTest', () => dbSelfTest())
  ipcMain.handle('embed:selfTest', () => embedSelfTest())
  ipcMain.handle('embed:modelStatus', () => getModelStatus())

  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => quitAndInstall())
  ipcMain.handle('update:version', () => app.getVersion())

  ipcMain.handle('backup:create', async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const path = await saveDialog({
      defaultPath: `superstar-backup-${stamp}.db`,
      filters: [{ name: 'SQLite database', extensions: ['db'] }]
    })
    if (!path) return { saved: false }
    return { saved: true, ...backupTo(path) }
  })
}
