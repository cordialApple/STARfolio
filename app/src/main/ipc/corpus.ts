import { z } from 'zod'
import { type IpcMain } from 'electron'
import { handle, idArg } from './shared'
import { ingestCorpusFiles, ingestCorpusUrl } from '../ingest/corpus-service'
import { listCorpusDocs, deleteCorpusDoc, corpusDisciplines } from '../db/repositories/corpus'

export function registerCorpus(ipcMain: IpcMain): void {
  const disciplineOpt = z.string().trim().max(80).optional()
  const corpusFilesArg = z.object({
    paths: z.array(z.string().min(1).max(4000)).min(1).max(50),
    discipline: z.string().trim().max(80).default('')
  })
  handle(ipcMain, 'corpus:addFiles', corpusFilesArg, (_e, { paths, discipline }) =>
    ingestCorpusFiles(paths, discipline)
  )
  const corpusUrlArg = z.object({
    url: z.string().trim().min(1).max(4000),
    discipline: z.string().trim().max(80).default('')
  })
  handle(ipcMain, 'corpus:addUrl', corpusUrlArg, (_e, { url, discipline }) => ingestCorpusUrl(url, discipline))
  handle(ipcMain, 'corpus:list', z.object({ discipline: disciplineOpt }), (_e, { discipline }) =>
    listCorpusDocs(discipline)
  )
  handle(ipcMain, 'corpus:remove', idArg, (_e, { id }) => deleteCorpusDoc(id))
  ipcMain.handle('corpus:disciplines', () => corpusDisciplines())
}
