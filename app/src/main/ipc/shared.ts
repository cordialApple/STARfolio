import { z } from 'zod'
import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { Prefs } from '../settings/prefs'
import { enqueueEmbed, kickEmbedDrain } from '../embed/queue'
import { reconcileVault } from '../vault/store'
import { nodeVaultFs } from '../vault/node-fs'

export const nonEmpty = z.string().min(1)
export const idArg = z.object({ id: nonEmpty.max(64) })
export const sessionArg = z.object({ sessionId: nonEmpty.max(64) })

export interface IpcHooks {
  onPrefsChange?: (prefs: Prefs) => void
}

export function handle<S extends z.ZodTypeAny, R>(
  ipcMain: IpcMain,
  channel: string,
  schema: S,
  fn: (event: IpcMainInvokeEvent, arg: z.infer<S>) => R
): void {
  ipcMain.handle(channel, (event, raw) => fn(event, schema.parse(raw)))
}

export async function saveDialog(opts: Electron.SaveDialogOptions): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  return res.canceled || !res.filePath ? null : res.filePath
}

export async function openPaths(opts: Electron.OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.getFocusedWindow()
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths
}

export async function openDialog(opts: Electron.OpenDialogOptions): Promise<string | null> {
  return (await openPaths(opts))[0] ?? null
}

export function enqueueEmbedAll(ids: Iterable<string>): void {
  let any = false
  for (const id of ids) {
    enqueueEmbed(id)
    any = true
  }
  if (any) kickEmbedDrain()
}

export async function runVaultSync(dir: string): Promise<{ imported: number; exported: number }> {
  const res = await reconcileVault(nodeVaultFs, dir, (id) => enqueueEmbed(id))
  if (res.imported) kickEmbedDrain()
  return res
}
