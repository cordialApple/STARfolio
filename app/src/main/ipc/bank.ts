import { z } from 'zod'
import { type IpcMain } from 'electron'
import { handle, idArg, nonEmpty, saveDialog, openDialog, enqueueEmbedAll, runVaultSync } from './shared'
import { experienceInput, listFilter } from '../db/repositories/experiences'
import { getExperienceStore } from '../store/experience-store'
import { searchExperiences, matchBankedStory } from '../search'
import { exportBank, importBank } from '../db/bank'
import { writeFileSync, readFileSync } from 'fs'
import { getPrefs, setPrefs } from '../settings/prefs'
import { readVault } from '../vault/sync'
import { nodeVaultFs } from '../vault/node-fs'
import { syncPersonalServerConfig } from '../integration/personalserver-config-writer'

const updateArg = z.object({ id: nonEmpty.max(64), input: experienceInput })
const jsonFilter = [{ name: 'JSON', extensions: ['json'] }]

export function registerBank(ipcMain: IpcMain): void {
  handle(ipcMain, 'bank:create', experienceInput, async (_e, input) => {
    const exp = await getExperienceStore().create(input)
    enqueueEmbedAll([exp.id])
    return exp
  })
  handle(ipcMain, 'bank:update', updateArg, async (_e, { id, input }) => {
    const exp = await getExperienceStore().update(id, input)
    enqueueEmbedAll([exp.id])
    return exp
  })
  handle(ipcMain, 'bank:delete', idArg, (_e, { id }) => getExperienceStore().delete(id))
  handle(ipcMain, 'bank:get', idArg, (_e, { id }) => getExperienceStore().get(id))
  handle(ipcMain, 'bank:list', listFilter, (_e, filter) => getExperienceStore().list(filter))
  handle(ipcMain, 'bank:search', listFilter, (_e, filter) => searchExperiences(filter))
  handle(ipcMain, 'bank:matchStory', z.object({ text: z.string().trim().min(1).max(20_000) }), (_e, { text }) =>
    matchBankedStory(text)
  )
  ipcMain.handle('bank:skills', () => getExperienceStore().listSkills())
  ipcMain.handle('bank:tags', () => getExperienceStore().listTags())

  ipcMain.handle('bank:exportJson', async () => {
    const path = await saveDialog({ defaultPath: 'starfolio-bank.json', filters: jsonFilter })
    if (!path) return { saved: false }
    writeFileSync(path, JSON.stringify(exportBank(), null, 2), 'utf8')
    return { saved: true, path }
  })
  ipcMain.handle('bank:importJson', async () => {
    const path = await openDialog({ properties: ['openFile'], filters: jsonFilter })
    if (!path) return { imported: 0, canceled: true }
    const { imported, ids } = importBank(JSON.parse(readFileSync(path, 'utf8')))
    enqueueEmbedAll(ids)
    return { imported, canceled: false }
  })

  ipcMain.handle('vault:choose', async () => {
    const path = await openDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (!path) return { canceled: true }
    syncPersonalServerConfig(setPrefs({ vaultPath: path }))
    return { canceled: false, path }
  })
  ipcMain.handle('vault:sync', async () => {
    const dir = getPrefs().vaultPath
    if (!dir) return { imported: 0, exported: 0, error: 'no-vault' as const }
    return runVaultSync(dir)
  })
  ipcMain.handle('vault:status', async () => {
    const { storageMode, vaultPath } = getPrefs()
    let notes: number | null = null
    if (vaultPath) {
      try {
        notes = (await readVault(nodeVaultFs, vaultPath)).length
      } catch {
        notes = null
      }
    }
    return { storageMode, vaultPath, notes }
  })
}
