import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcApi, ModelStatus, WhisperModelInfo } from './index.d'

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
    files: (paths) => ipcRenderer.invoke('ingest:files', { paths }),
    url: (url) => ipcRenderer.invoke('ingest:url', { url }),
    openSource: (source) => ipcRenderer.invoke('ingest:openSource', source),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  resume: {
    extract: (text) => ipcRenderer.invoke('resume:extract', { text })
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
    get: (sessionId) => ipcRenderer.invoke('practice:get', { sessionId }),
    list: () => ipcRenderer.invoke('practice:list')
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
  }
}

contextBridge.exposeInMainWorld('api', api)
