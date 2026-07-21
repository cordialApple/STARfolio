import { z } from 'zod'
import { shell, type IpcMain } from 'electron'
import { handle, idArg, nonEmpty, openDialog, openPaths } from './shared'
import { setSecret, hasSecret, deleteSecret, getSecret } from '../settings/secrets'
import { extractEvidenceStar, extractEntities } from '../ai/extract'
import { ingestFiles, ingestUrl, ingestCodeFolder, ingestRepo } from '../ingest/service'
import { getSource } from '../db/repositories/sources'
import { linkExperienceEntities, neighborsOf, ENTITY_KINDS } from '../db/repositories/graph'
import { backfillEntities } from '../graph-backfill'
import { assertPublicHttpUrl } from '../ingest/fetch-url'

export function registerIngest(ipcMain: IpcMain): void {
  ipcMain.handle('ingest:pickFiles', () =>
    openPaths({
      title: 'Import documents',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }]
    })
  )
  const ingestFilesArg = z.object({ paths: z.array(z.string().min(1).max(4000)).min(1).max(50) })
  handle(ipcMain, 'ingest:files', ingestFilesArg, (_e, { paths }) => ingestFiles(paths))
  const ingestUrlArg = z.object({ url: z.string().trim().min(1).max(4000) })
  handle(ipcMain, 'ingest:url', ingestUrlArg, (_e, { url }) => ingestUrl(url))
  ipcMain.handle('ingest:pickFolder', () =>
    openDialog({ title: 'Import a code folder', properties: ['openDirectory'] })
  )
  handle(ipcMain, 'ingest:codeFolder', z.object({ path: z.string().min(1).max(4000) }), (_e, { path }) =>
    ingestCodeFolder(path)
  )
  handle(ipcMain, 'ingest:repo', z.object({ url: z.string().trim().min(1).max(4000) }), (_e, { url }) =>
    ingestRepo(url, getSecret('github_pat') ?? undefined)
  )

  const evidenceArg = z.object({
    text: z.string().min(1).max(2_000_000),
    kind: z.enum(['spreadsheet', 'code', 'repo'])
  })
  handle(ipcMain, 'evidence:extract', evidenceArg, (_e, { text, kind }) => extractEvidenceStar(text, kind))
  handle(ipcMain, 'entity:extract', z.object({ text: z.string().min(1).max(2_000_000) }), (_e, { text }) =>
    extractEntities(text)
  )
  const linkArg = z.object({
    experienceId: nonEmpty.max(64),
    entities: z.array(z.object({ kind: z.enum(ENTITY_KINDS), name: z.string().trim().min(1).max(120) })).max(60)
  })
  handle(ipcMain, 'graph:link', linkArg, (_e, { experienceId, entities }) => {
    linkExperienceEntities(experienceId, entities)
  })
  handle(ipcMain, 'graph:neighbors', idArg, (_e, { id }) => neighborsOf(id))
  ipcMain.handle('graph:backfill', () => backfillEntities())

  ipcMain.handle('github:hasPat', () => hasSecret('github_pat'))
  ipcMain.handle('github:deletePat', () => deleteSecret('github_pat'))
  handle(ipcMain, 'github:setPat', nonEmpty.max(500), (_e, pat) => setSecret('github_pat', pat))

  handle(ipcMain, 'ingest:openSource', idArg, async (_e, { id }) => {
    // Resolve the path/url from our own DB — never trust a renderer-supplied path.
    const s = getSource(id)
    if (!s) return
    if (s.kind === 'url' && s.uri_or_path) {
      assertPublicHttpUrl(s.uri_or_path)
      await shell.openExternal(s.uri_or_path)
    } else if (s.attachment_path) {
      await shell.openPath(s.attachment_path)
    }
  })
}
