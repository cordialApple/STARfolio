import { app, Menu, Tray, nativeImage } from 'electron'

const ICON_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7UlEQVR42u2XwQ3GIAiFOwiLOIgTNOmdRTqIg7AIE3SC/hebmMZSAlQv/+Fd4VN5T13W7VhmylsgV00DoKopALBux1kFMwCwAcAZANQA0GiA1DS/lEYC7B2AfSQAdwB4FEBv+83HcLdVVogFAFbWgB4ACoWjhU9H8LZCr/ge3U8JRx80p15iSgNSApsXqwtyQPPstSEY54I1l5Tl5tMKIoMoGQBSJAB6vB4BQEbbhQFIgyYNaAhAFrwNVcViQS1AeYtTIcZLBAC/xakQ4+wFSMaHJ2rtqClExmf3tRvo3QHv5yV9+TOa/jf8A7j1A/nl+ACRr0YpAAAAAElFTkSuQmCC'

let tray: Tray | null = null

export function syncTray(resident: boolean, onShow: () => void, onQuit: () => void): void {
  if (!resident) {
    destroyTray()
    return
  }
  if (tray) return
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG}`)
  tray = new Tray(icon)
  tray.setToolTip('STARfolio')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open STARfolio', click: onShow },
      { type: 'separator' },
      { label: 'Quit', click: onQuit }
    ])
  )
  tray.on('click', onShow)
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export function applyLoginItem(launchAtLogin: boolean): void {
  if (process.platform === 'linux') return
  app.setLoginItemSettings({ openAtLogin: launchAtLogin })
}
