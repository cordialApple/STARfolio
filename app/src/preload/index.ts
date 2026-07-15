import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcApi, ModelStatus, WhisperModelInfo, UpdateStatus } from './index.d'

const api: IpcApi = {
  ping: () => ipcRenderer.invoke('ping'),
  db: {
    selfTest: () => ipcRenderer.invoke('db:selfTest')
  },
  embed: {
    selfTest: () => ipcRenderer.invoke('embed:selfTest'),
    modelStatus: () => ipcRenderer.invoke('embed:modelStatus'),
    onStatus: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, status: ModelStatus): void => cb(status)
      ipcRenderer.on('embed:status', handler)
      return () => ipcRenderer.removeListener('embed:status', handler)
    }
  },
  voice: {
    transcribe: (pcm, model) => ipcRenderer.invoke('voice:transcribe', { pcm, model }),
    models: () => ipcRenderer.invoke('voice:models'),
    downloadModel: (model) => ipcRenderer.invoke('voice:downloadModel', { model }),
    deleteModel: (model) => ipcRenderer.invoke('voice:deleteModel', { model }),
    onModelStatus: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, models: WhisperModelInfo[]): void => cb(models)
      ipcRenderer.on('voice:modelStatus', handler)
      return () => ipcRenderer.removeListener('voice:modelStatus', handler)
    }
  },
  ai: {
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    hasKey: () => ipcRenderer.invoke('ai:hasKey'),
    deleteKey: () => ipcRenderer.invoke('ai:deleteKey'),
    stream: (prompt, requestId) => ipcRenderer.invoke('ai:stream', { prompt, requestId }),
    cancel: (requestId) => ipcRenderer.invoke('ai:cancel', requestId),
    onToken: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, requestId: string, token: string): void =>
        cb(requestId, token)
      ipcRenderer.on('ai:token', handler)
      return () => ipcRenderer.removeListener('ai:token', handler)
    },
    onDone: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, requestId: string): void => cb(requestId)
      ipcRenderer.on('ai:done', handler)
      return () => ipcRenderer.removeListener('ai:done', handler)
    },
    onError: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, requestId: string, msg: string): void =>
        cb(requestId, msg)
      ipcRenderer.on('ai:error', handler)
      return () => ipcRenderer.removeListener('ai:error', handler)
    }
  },
  brain: {
    extract: (text) => ipcRenderer.invoke('brain:extract', { text })
  },
  ingest: {
    pickFiles: () => ipcRenderer.invoke('ingest:pickFiles'),
    pickFolder: () => ipcRenderer.invoke('ingest:pickFolder'),
    files: (paths) => ipcRenderer.invoke('ingest:files', { paths }),
    url: (url) => ipcRenderer.invoke('ingest:url', { url }),
    codeFolder: (path) => ipcRenderer.invoke('ingest:codeFolder', { path }),
    repo: (url) => ipcRenderer.invoke('ingest:repo', { url }),
    openSource: (id) => ipcRenderer.invoke('ingest:openSource', { id }),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  resume: {
    extract: (text) => ipcRenderer.invoke('resume:extract', { text })
  },
  materials: {
    bullets: (jdText, experienceIds) =>
      ipcRenderer.invoke('bullets:generate', { jdText, experienceIds }),
    export: (markdown, format, filename) =>
      ipcRenderer.invoke('resume:export', { markdown, format, filename })
  },
  evidence: {
    extract: (text, kind) => ipcRenderer.invoke('evidence:extract', { text, kind })
  },
  entity: {
    extract: (text) => ipcRenderer.invoke('entity:extract', { text })
  },
  graph: {
    link: (experienceId, entities) => ipcRenderer.invoke('graph:link', { experienceId, entities }),
    neighbors: (id) => ipcRenderer.invoke('graph:neighbors', { id }),
    backfill: () => ipcRenderer.invoke('graph:backfill')
  },
  github: {
    setPat: (pat) => ipcRenderer.invoke('github:setPat', pat),
    hasPat: () => ipcRenderer.invoke('github:hasPat'),
    deletePat: () => ipcRenderer.invoke('github:deletePat')
  },
  story: {
    generate: (config) => ipcRenderer.invoke('story:generate', config),
    cancel: (requestId) => ipcRenderer.invoke('story:cancel', requestId),
    save: (input) => ipcRenderer.invoke('story:save', input),
    get: (id) => ipcRenderer.invoke('story:get', { id }),
    list: () => ipcRenderer.invoke('story:list')
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', { text })
  },
  practice: {
    start: (config) => ipcRenderer.invoke('practice:start', config),
    answer: (sessionId, answer) => ipcRenderer.invoke('practice:answer', { sessionId, answer }),
    end: (sessionId) => ipcRenderer.invoke('practice:end', { sessionId }),
    remove: (sessionId) => ipcRenderer.invoke('practice:delete', { sessionId }),
    get: (sessionId) => ipcRenderer.invoke('practice:get', { sessionId }),
    list: () => ipcRenderer.invoke('practice:list')
  },
  technical: {
    start: (config) => ipcRenderer.invoke('technical:start', config),
    answer: (sessionId, answer) => ipcRenderer.invoke('technical:answer', { sessionId, answer }),
    get: (sessionId) => ipcRenderer.invoke('technical:get', { sessionId }),
    end: (sessionId) => ipcRenderer.invoke('technical:end', { sessionId }),
    remove: (sessionId) => ipcRenderer.invoke('technical:delete', { sessionId }),
    list: () => ipcRenderer.invoke('technical:list')
  },
  interview: {
    start: (input) => ipcRenderer.invoke('interview:start', input),
    answer: (sessionId, answer, elapsedMs) =>
      ipcRenderer.invoke('interview:answer', { sessionId, answer, elapsedMs }),
    report: (sessionId) => ipcRenderer.invoke('interview:report', { sessionId }),
    list: () => ipcRenderer.invoke('interview:list'),
    get: (sessionId) => ipcRenderer.invoke('interview:get', { sessionId }),
    remove: (sessionId) => ipcRenderer.invoke('interview:delete', { sessionId })
  },
  corpus: {
    addFiles: (paths, discipline) => ipcRenderer.invoke('corpus:addFiles', { paths, discipline }),
    addUrl: (url, discipline) => ipcRenderer.invoke('corpus:addUrl', { url, discipline }),
    list: (discipline) => ipcRenderer.invoke('corpus:list', { discipline }),
    remove: (id) => ipcRenderer.invoke('corpus:remove', { id }),
    disciplines: () => ipcRenderer.invoke('corpus:disciplines')
  },
  bank: {
    create: (input) => ipcRenderer.invoke('bank:create', input),
    update: (id, input) => ipcRenderer.invoke('bank:update', { id, input }),
    remove: (id) => ipcRenderer.invoke('bank:delete', { id }),
    get: (id) => ipcRenderer.invoke('bank:get', { id }),
    list: (filter) => ipcRenderer.invoke('bank:list', filter),
    search: (filter) => ipcRenderer.invoke('bank:search', filter),
    matchStory: (text) => ipcRenderer.invoke('bank:matchStory', { text }),
    skills: () => ipcRenderer.invoke('bank:skills'),
    tags: () => ipcRenderer.invoke('bank:tags')
  },
  backup: {
    exportJson: () => ipcRenderer.invoke('bank:exportJson'),
    importJson: () => ipcRenderer.invoke('bank:importJson'),
    create: () => ipcRenderer.invoke('backup:create')
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch)
  },
  nudge: {
    staleness: () => ipcRenderer.invoke('nudge:staleness')
  },
  usage: {
    summary: () => ipcRenderer.invoke('usage:summary')
  },
  update: {
    version: () => ipcRenderer.invoke('update:version'),
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, status: UpdateStatus): void => cb(status)
      ipcRenderer.on('update:status', handler)
      return () => ipcRenderer.removeListener('update:status', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
