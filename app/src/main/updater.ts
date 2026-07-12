import { app, type WebContents } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let status: UpdateStatus = { state: 'idle' }
let resolveSender: () => WebContents | null = () => null

function push(next: UpdateStatus): void {
  status = next
  const sender = resolveSender()
  if (sender && !sender.isDestroyed()) sender.send('update:status', next)
}

let wired = false
function ensureWired(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => push({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => push({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    push({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    push({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => push({ state: 'error', message: err.message }))
}

export function initUpdater(getSender: () => WebContents | null): void {
  resolveSender = getSender
}

export function updateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    push({ state: 'error', message: 'Updates are only available in the installed app.' })
    return status
  }
  ensureWired()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    push({ state: 'error', message: (err as Error).message })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) return status
  ensureWired()
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    push({ state: 'error', message: (err as Error).message })
  }
  return status
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall()
}
