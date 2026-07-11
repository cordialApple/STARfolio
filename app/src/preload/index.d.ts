export interface DbApi {
  selfTest: () => Promise<{ ok: boolean; fts: number; knn: number }>
}

export interface EmbedApi {
  selfTest: () => Promise<{ ok: boolean; dims: number; knn: number }>
}

export interface VoiceApi {
  transcribe: (pcm: number[], model?: string) => Promise<string>
}

export interface AiApi {
  setKey: (key: string) => Promise<void>
  hasKey: () => Promise<boolean>
  deleteKey: () => Promise<void>
  stream: (prompt: string, requestId: string) => Promise<void>
  cancel: (requestId: string) => Promise<void>
  onToken: (cb: (requestId: string, token: string) => void) => () => void
  onDone: (cb: (requestId: string) => void) => () => void
  onError: (cb: (requestId: string, msg: string) => void) => () => void
}

export interface IpcApi {
  ping: () => Promise<string>
  db: DbApi
  embed: EmbedApi
  voice: VoiceApi
  ai: AiApi
}

declare global {
  interface Window {
    api: IpcApi
  }
}
