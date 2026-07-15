import { z } from 'zod'
import { app, clipboard, dialog, shell, BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { setSecret, hasSecret, deleteSecret, getSecret } from './settings/secrets'
import { startChat, cancelStream } from './ai/client'
import { extractStar, extractResumeStar, extractEvidenceStar, extractEntities } from './ai/extract'
import { ingestFiles, ingestUrl, ingestCodeFolder, ingestRepo } from './ingest/service'
import { getSource } from './db/repositories/sources'
import { linkExperienceEntities, neighborsOf, ENTITY_KINDS } from './db/repositories/graph'
import { backfillEntities } from './graph-backfill'
import { assertPublicHttpUrl } from './ingest/fetch-url'
import { streamStory, storyConfig } from './ai/story'
import { saveStory, getStory, listStories, storySaveInput } from './db/repositories/stories'
import { startPractice, answerPractice, answerArg } from './practice'
import { startTechnical, answerTechnical, technicalAnswerArg } from './technical'
import {
  startInterview,
  answerInterview,
  getInterviewReport,
  listInterviewSessions,
  getInterviewSession,
  deleteInterviewSession
} from './ai/session'
import { practiceConfig } from './ai/interview'
import { technicalConfig } from './ai/technical'
import { ingestCorpusFiles, ingestCorpusUrl } from './ingest/corpus-service'
import { listCorpusDocs, deleteCorpusDoc, corpusDisciplines } from './db/repositories/corpus'
import { generateBullets } from './ai/bullets'
import { markdownToDocx } from './export/docx'
import { writeFileSync, readFileSync } from 'fs'
import { exportBank, importBank, backupTo } from './db/backup'
import { getPrefs, setPrefs, staleness, prefsPatch, type Prefs } from './settings/prefs'
import { checkForUpdate, downloadUpdate, quitAndInstall, updateStatus } from './updater'
import { usageSummary } from './ai/usage'
import {
  getSession,
  listSessions,
  endSession,
  deleteSession,
  getTechnicalSession,
  listTechnicalSessions,
  endTechnicalSession,
  deleteTechnicalSession
} from './db/repositories/practice'
import { searchExperiences, matchBankedStory } from './search'
import { enqueueEmbed, kickEmbedDrain } from './embed/queue'
import { dbSelfTest } from './db/client'
import { embedSelfTest, getModelStatus } from './embed'
import { transcribe } from './voice'
import { whisperModels, ensureWhisperModel, deleteWhisperModel, WHISPER_MODELS } from './voice/model'
import {
  experienceInput,
  listFilter,
  createExperience,
  updateExperience,
  deleteExperience,
  getExperience,
  listExperiences,
  listSkills,
  listTags
} from './db/repositories/experiences'

const nonEmpty = z.string().min(1)
const MAX_PROMPT = 100_000
const MAX_PCM_SAMPLES = 16_000 * 300 // 5 minutes at 16 kHz — a generous upper bound

const streamArg = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT),
  requestId: z.string().uuid()
})
const transcribeArg = z.object({
  pcm: z.array(z.number()).min(1).max(MAX_PCM_SAMPLES),
  model: z.enum(WHISPER_MODELS).optional()
})
const voiceModelArg = z.object({ model: z.enum(WHISPER_MODELS) })

const idArg = z.object({ id: nonEmpty.max(64) })
const updateArg = z.object({ id: nonEmpty.max(64), input: experienceInput })
const extractArg = z.object({ text: z.string().min(1).max(200_000) })
const copyArg = z.object({ text: z.string().max(50_000) })

function handle<S extends z.ZodTypeAny, R>(
  ipcMain: IpcMain,
  channel: string,
  schema: S,
  fn: (event: IpcMainInvokeEvent, arg: z.infer<S>) => R
): void {
  ipcMain.handle(channel, (event, raw) => fn(event, schema.parse(raw)))
}

export interface IpcHooks {
  onPrefsChange?: (prefs: Prefs) => void
}

export function registerIpcHandlers(ipcMain: IpcMain, hooks: IpcHooks = {}): void {
  async function saveDialog(opts: Electron.SaveDialogOptions): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return res.canceled || !res.filePath ? null : res.filePath
  }
  async function openDialog(opts: Electron.OpenDialogOptions): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  }

  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('prefs:get', () => getPrefs())
  handle(ipcMain, 'prefs:set', prefsPatch, (_e, patch) => {
    const next = setPrefs(patch)
    hooks.onPrefsChange?.(next)
    return next
  })
  ipcMain.handle('nudge:staleness', () => staleness())
  ipcMain.handle('usage:summary', () => usageSummary())
  ipcMain.handle('db:selfTest', () => dbSelfTest())
  ipcMain.handle('embed:selfTest', () => embedSelfTest())
  ipcMain.handle('embed:modelStatus', () => getModelStatus())
  handle(ipcMain, 'voice:transcribe', transcribeArg, (_e, { pcm, model }) => transcribe(pcm, model))
  ipcMain.handle('voice:models', () => whisperModels())
  handle(ipcMain, 'voice:downloadModel', voiceModelArg, (_e, { model }) =>
    ensureWhisperModel(model).then(() => whisperModels())
  )
  handle(ipcMain, 'voice:deleteModel', voiceModelArg, (_e, { model }) => {
    deleteWhisperModel(model)
    return whisperModels()
  })

  ipcMain.handle('ai:hasKey', () => hasSecret('anthropic_api_key'))
  ipcMain.handle('ai:deleteKey', () => deleteSecret('anthropic_api_key'))
  handle(ipcMain, 'ai:setKey', nonEmpty, (_e, key) => setSecret('anthropic_api_key', key))
  handle(ipcMain, 'ai:stream', streamArg, (event, { prompt, requestId }) =>
    startChat(prompt, requestId, event.sender)
  )
  handle(ipcMain, 'ai:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))

  handle(ipcMain, 'brain:extract', extractArg, (_e, { text }) => extractStar(text))
  handle(ipcMain, 'resume:extract', extractArg, (_e, { text }) => extractResumeStar(text))

  ipcMain.handle('ingest:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import documents',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  })
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

  handle(ipcMain, 'story:generate', storyConfig, (event, config) =>
    streamStory(config, event.sender)
  )
  handle(ipcMain, 'story:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))
  const bulletsArg = z.object({
    jdText: z.string().trim().min(1).max(20_000),
    experienceIds: z.array(z.string().min(1).max(64)).min(1).max(20)
  })
  handle(ipcMain, 'bullets:generate', bulletsArg, (_e, { jdText, experienceIds }) =>
    generateBullets(jdText, experienceIds)
  )
  const exportArg = z.object({
    markdown: z.string().min(1).max(100_000),
    format: z.enum(['md', 'docx']),
    filename: z.string().trim().max(120).default('resume')
  })
  handle(ipcMain, 'resume:export', exportArg, async (_e, { markdown, format, filename }) => {
    const safe = filename.replace(/[^\w.-]+/g, '-') || 'resume'
    const path = await saveDialog({
      defaultPath: `${safe}.${format}`,
      filters: [{ name: format === 'docx' ? 'Word document' : 'Markdown', extensions: [format] }]
    })
    if (!path) return { saved: false }
    writeFileSync(path, format === 'docx' ? markdownToDocx(markdown) : Buffer.from(markdown, 'utf8'))
    return { saved: true, path }
  })

  handle(ipcMain, 'story:save', storySaveInput, (_e, input) => saveStory(input))
  handle(ipcMain, 'story:get', idArg, (_e, { id }) => getStory(id))
  ipcMain.handle('story:list', () => listStories())

  handle(ipcMain, 'clipboard:write', copyArg, (_e, { text }) => clipboard.writeText(text))

  const sessionArg = z.object({ sessionId: nonEmpty.max(64) })
  handle(ipcMain, 'practice:start', practiceConfig, (_e, config) => startPractice(config))
  handle(ipcMain, 'practice:answer', answerArg, (_e, arg) => answerPractice(arg))
  handle(ipcMain, 'practice:end', sessionArg, (_e, { sessionId }) => endSession(sessionId))
  handle(ipcMain, 'practice:delete', sessionArg, (_e, { sessionId }) => deleteSession(sessionId))
  handle(ipcMain, 'practice:get', sessionArg, (_e, { sessionId }) => getSession(sessionId))
  ipcMain.handle('practice:list', () => listSessions())

  handle(ipcMain, 'technical:start', technicalConfig, (_e, config) => startTechnical(config))
  handle(ipcMain, 'technical:answer', technicalAnswerArg, (_e, arg) => answerTechnical(arg))
  handle(ipcMain, 'technical:get', sessionArg, (_e, { sessionId }) => getTechnicalSession(sessionId))
  handle(ipcMain, 'technical:end', sessionArg, (_e, { sessionId }) => endTechnicalSession(sessionId))
  handle(ipcMain, 'technical:delete', sessionArg, (_e, { sessionId }) =>
    deleteTechnicalSession(sessionId)
  )
  ipcMain.handle('technical:list', () => listTechnicalSessions())

  const MAX_INTERVIEW_EXPERIENCES = 40
  // Resume the roadmap from our own confirmed bank — never trust a renderer-supplied experience list.
  const interviewBank = (): { id: string; title: string; summary: string }[] =>
    listExperiences({ status: 'confirmed' })
      .slice(0, MAX_INTERVIEW_EXPERIENCES)
      .map((e) => ({ id: e.id, title: e.title, summary: e.snippet }))
  const interviewStartArg = z.object({
    resumeText: z.string().trim().min(1).max(200_000),
    candidateName: z.string().trim().max(200).optional(),
    level: z.enum(['entry', 'mid', 'senior']).optional()
  })
  const interviewAnswerArg = z.object({
    sessionId: nonEmpty.max(64),
    answer: z.string().trim().min(1).max(20_000),
    elapsedMs: z.number().min(0).optional()
  })
  handle(ipcMain, 'interview:start', interviewStartArg, (_e, arg) =>
    startInterview({ ...arg, experiences: interviewBank() })
  )
  handle(ipcMain, 'interview:answer', interviewAnswerArg, (_e, arg) => answerInterview(arg))
  handle(ipcMain, 'interview:report', sessionArg, (_e, { sessionId }) => getInterviewReport(sessionId))
  ipcMain.handle('interview:list', () => listInterviewSessions())
  handle(ipcMain, 'interview:get', sessionArg, (_e, { sessionId }) => getInterviewSession(sessionId))
  handle(ipcMain, 'interview:delete', sessionArg, (_e, { sessionId }) =>
    deleteInterviewSession(sessionId)
  )

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
  handle(ipcMain, 'corpus:addUrl', corpusUrlArg, (_e, { url, discipline }) =>
    ingestCorpusUrl(url, discipline)
  )
  handle(ipcMain, 'corpus:list', z.object({ discipline: disciplineOpt }), (_e, { discipline }) =>
    listCorpusDocs(discipline)
  )
  handle(ipcMain, 'corpus:remove', idArg, (_e, { id }) => deleteCorpusDoc(id))
  ipcMain.handle('corpus:disciplines', () => corpusDisciplines())

  handle(ipcMain, 'bank:create', experienceInput, (_e, input) => {
    const exp = createExperience(input)
    enqueueEmbed(exp.id)
    kickEmbedDrain()
    return exp
  })
  handle(ipcMain, 'bank:update', updateArg, (_e, { id, input }) => {
    const exp = updateExperience(id, input)
    enqueueEmbed(exp.id)
    kickEmbedDrain()
    return exp
  })
  handle(ipcMain, 'bank:delete', idArg, (_e, { id }) => deleteExperience(id))
  handle(ipcMain, 'bank:get', idArg, (_e, { id }) => getExperience(id))
  handle(ipcMain, 'bank:list', listFilter, (_e, filter) => listExperiences(filter))
  handle(ipcMain, 'bank:search', listFilter, (_e, filter) => searchExperiences(filter))
  handle(ipcMain, 'bank:matchStory', z.object({ text: z.string().trim().min(1).max(20_000) }), (_e, { text }) =>
    matchBankedStory(text)
  )
  ipcMain.handle('bank:skills', () => listSkills())
  ipcMain.handle('bank:tags', () => listTags())

  const jsonFilter = [{ name: 'JSON', extensions: ['json'] }]

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
    for (const id of ids) enqueueEmbed(id)
    if (ids.length) kickEmbedDrain()
    return { imported, canceled: false }
  })
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
