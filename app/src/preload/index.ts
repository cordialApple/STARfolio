import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi, ModelStatus } from './index.d'

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
    transcribe: (pcm, model) => ipcRenderer.invoke('voice:transcribe', { pcm, model })
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
  bank: {
    create: (input) => ipcRenderer.invoke('bank:create', input),
    update: (id, input) => ipcRenderer.invoke('bank:update', { id, input }),
    remove: (id) => ipcRenderer.invoke('bank:delete', { id }),
    get: (id) => ipcRenderer.invoke('bank:get', { id }),
    list: (filter) => ipcRenderer.invoke('bank:list', filter),
    search: (filter) => ipcRenderer.invoke('bank:search', filter),
    skills: () => ipcRenderer.invoke('bank:skills'),
    tags: () => ipcRenderer.invoke('bank:tags')
  }
}

contextBridge.exposeInMainWorld('api', api)
