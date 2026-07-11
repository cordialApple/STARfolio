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

export type ExperienceContext = 'work' | 'project' | 'class' | 'other'
export type ExperienceStatus = 'draft' | 'confirmed'
export type SkillKind = 'technical' | 'soft' | 'domain'

export interface Skill {
  id: string
  name: string
  kind: SkillKind
}
export interface Tag {
  id: string
  name: string
}
export interface Metric {
  id: string
  label: string
  value: number | null
  unit: string | null
}
export interface MetricInput {
  label: string
  value?: number | null
  unit?: string | null
}
export interface SkillInput {
  name: string
  kind: SkillKind
}
export interface Experience {
  id: string
  title: string
  situation: string
  task: string
  action: string
  result_text: string
  context: ExperienceContext
  happened_start: string | null
  happened_end: string | null
  status: ExperienceStatus
  created_at: string
  updated_at: string
  skills: Skill[]
  tags: Tag[]
  metrics: Metric[]
}
export interface ExperienceInput {
  title: string
  situation: string
  task: string
  action: string
  result_text: string
  context: ExperienceContext
  happened_start?: string | null
  happened_end?: string | null
  status: ExperienceStatus
  skills: SkillInput[]
  tags: string[]
  metrics: MetricInput[]
}
export interface ExperienceSummary {
  id: string
  title: string
  context: ExperienceContext
  status: ExperienceStatus
  happened_start: string | null
  happened_end: string | null
  updated_at: string
  filled: { situation: boolean; task: boolean; action: boolean; result: boolean }
  snippet: string
  skills: string[]
  tags: string[]
}
export interface ListFilter {
  query?: string
  context?: ExperienceContext
  status?: ExperienceStatus
  skill?: string
  tag?: string
  dateStart?: string | null
  dateEnd?: string | null
}

export interface BankApi {
  create: (input: ExperienceInput) => Promise<Experience>
  update: (id: string, input: ExperienceInput) => Promise<Experience>
  remove: (id: string) => Promise<{ deleted: boolean }>
  get: (id: string) => Promise<Experience | null>
  list: (filter: ListFilter) => Promise<ExperienceSummary[]>
  skills: () => Promise<Skill[]>
  tags: () => Promise<Tag[]>
}

export interface IpcApi {
  ping: () => Promise<string>
  db: DbApi
  embed: EmbedApi
  voice: VoiceApi
  ai: AiApi
  bank: BankApi
}

declare global {
  interface Window {
    api: IpcApi
  }
}
