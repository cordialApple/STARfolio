import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { initDb } from './db/client'
import { stopEmbedWorker } from './embed'
import { stopWhisperWorker } from './voice'

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

  win.on('ready-to-show', () => {
    win.show()
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.brandonsuperstar.superstar')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  configureMicPermissions()
  initDb()
  registerIpcHandlers(ipcMain)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  stopEmbedWorker()
  stopWhisperWorker()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
