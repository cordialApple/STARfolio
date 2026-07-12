import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { initDb } from './db/client'
import { stopEmbedWorker } from './embed'
import { backfillEmbeddings, kickEmbedDrain } from './embed/queue'
import { backfillCorpusEmbeddings, kickCorpusEmbedDrain } from './embed/corpus-queue'
import { stopWhisperWorker } from './voice'
import { stopIngestWorker } from './ingest'
import { getPrefs, type Prefs } from './settings/prefs'
import { startReminderScheduler, stopReminderScheduler } from './nudges/reminder'
import { syncTray, destroyTray, applyLoginItem } from './nudges/tray'
import { initUpdater } from './updater'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function configureMicPermissions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('close', (e) => {
    if (!isQuitting && getPrefs().trayResident) {
      e.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function quitApp(): void {
  isQuitting = true
  app.quit()
}

function applyPrefs(prefs: Prefs): void {
  applyLoginItem(prefs.launchAtLogin)
  syncTray(prefs.trayResident, showWindow, quitApp)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.brandonsuperstar.superstar')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    configureMicPermissions()
    initDb()
    initUpdater(() => mainWindow?.webContents ?? null)
    registerIpcHandlers(ipcMain, { onPrefsChange: applyPrefs })
    createWindow()
    applyPrefs(getPrefs())
    startReminderScheduler(showWindow)

    // Resume any embeds left pending by a prior run, and embed rows that predate embedding.
    try {
      backfillEmbeddings()
      kickEmbedDrain()
      backfillCorpusEmbeddings()
      kickCorpusEmbedDrain()
    } catch {
      // A missing model or worker must never block startup; the queue retries on its own.
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  stopReminderScheduler()
  destroyTray()
  stopEmbedWorker()
  stopWhisperWorker()
  stopIngestWorker()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !getPrefs().trayResident) app.quit()
})
