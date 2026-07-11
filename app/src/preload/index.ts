import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi } from './index.d'

const api: IpcApi = {
  ping: () => ipcRenderer.invoke('ping'),
  db: {
    selfTest: () => ipcRenderer.invoke('db:selfTest')
  },
  embed: {
    selfTest: () => ipcRenderer.invoke('embed:selfTest')
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
  }
}

contextBridge.exposeInMainWorld('api', api)
