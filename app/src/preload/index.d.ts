export interface DbApi {
  selfTest: () => Promise<{ ok: boolean; fts: number; knn: number }>
}

export type ModelPhase = 'idle' | 'downloading' | 'ready' | 'error'
export interface ModelStatus {
  phase: ModelPhase
  progress: number
  error: string | null
}
export interface EmbedApi {
  selfTest: () => Promise<{ ok: boolean; dims: number; knn: number }>
  modelStatus: () => Promise<ModelStatus>
  onStatus: (cb: (status: ModelStatus) => void) => () => void
}

export type WhisperModelName = 'tiny.en' | 'base.en' | 'small.en'
export interface WhisperModelInfo {
  name: WhisperModelName
  sizeMB: number
  downloaded: boolean
  status: ModelStatus
}
export interface VoiceApi {
  transcribe: (pcm: number[], model?: string) => Promise<string>
  models: () => Promise<WhisperModelInfo[]>
  downloadModel: (model: WhisperModelName) => Promise<WhisperModelInfo[]>
  deleteModel: (model: WhisperModelName) => Promise<WhisperModelInfo[]>
  onModelStatus: (cb: (models: WhisperModelInfo[]) => void) => () => void
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
export type SourceKind = 'paste' | 'file' | 'url' | 'repo' | 'spreadsheet' | 'code'
export interface Source {
  id: string
  kind: SourceKind
  title: string | null
  raw_text: string | null
  uri_or_path: string | null
  attachment_path: string | null
  ingested_at: string
}
export interface SourceInput {
  kind?: SourceKind
  raw_text: string
  title?: string | null
  uri_or_path?: string | null
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
  draft_state_json: string | null
  created_at: string
  updated_at: string
  skills: Skill[]
  tags: Tag[]
  metrics: Metric[]
  sources: Source[]
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
  draft_state_json?: string | null
  source?: SourceInput
  source_id?: string
}

export type Confidence = 'high' | 'medium' | 'low'
export interface ExtractedField {
  text: string
  confidence: Confidence
}
export type GapField = 'situation' | 'task' | 'action' | 'result' | 'metrics' | 'dates'
export interface StarExtraction {
  title: string
  context: ExperienceContext
  situation: ExtractedField
  task: ExtractedField
  action: ExtractedField
  result: ExtractedField
  skills: SkillInput[]
  tags: string[]
  metrics: MetricInput[]
  gaps: { field: GapField; question: string }[]
}

export interface BrainApi {
  extract: (text: string) => Promise<StarExtraction>
}

export interface IngestResult {
  ok: boolean
  name: string
  error?: string
  scanned?: boolean
  duplicate?: boolean
  source?: Source
}
export interface IngestApi {
  pickFiles: () => Promise<string[]>
  pickFolder: () => Promise<string | null>
  files: (paths: string[]) => Promise<IngestResult[]>
  url: (url: string) => Promise<IngestResult>
  codeFolder: (path: string) => Promise<IngestResult>
  repo: (url: string) => Promise<IngestResult>
  openSource: (id: string) => Promise<void>
  pathForFile: (file: File) => string
}
export interface ResumeApi {
  extract: (text: string) => Promise<StarExtraction[]>
}

export interface ResumeBullet {
  text: string
  experienceId: string
  experienceTitle: string
}
export interface MaterialsApi {
  bullets: (jdText: string, experienceIds: string[]) => Promise<ResumeBullet[]>
  export: (
    markdown: string,
    format: 'md' | 'docx',
    filename: string
  ) => Promise<{ saved: boolean; path?: string }>
}

export type EvidenceKind = 'spreadsheet' | 'code' | 'repo'
export interface EvidenceApi {
  extract: (text: string, kind: EvidenceKind) => Promise<StarExtraction>
}

export type EntityKind = 'person' | 'team' | 'project' | 'org' | 'tool' | 'other'
export interface EntityInput {
  kind: EntityKind
  name: string
}
export interface EntityApi {
  extract: (text: string) => Promise<{ entities: EntityInput[] }>
}

export interface EntityNode {
  id: string
  kind: EntityKind
  name: string
}
export interface Connection {
  experience: { id: string; title: string }
  viaEntities: string[]
  viaSkills: string[]
}
export interface Neighbors {
  entities: EntityNode[]
  connections: Connection[]
}
export interface GraphApi {
  link: (experienceId: string, entities: EntityInput[]) => Promise<void>
  neighbors: (id: string) => Promise<Neighbors>
  backfill: () => Promise<{ processed: number }>
}

export interface GithubApi {
  setPat: (pat: string) => Promise<void>
  hasPat: () => Promise<boolean>
  deletePat: () => Promise<void>
}

export type StoryLength = 'short' | 'medium' | 'detailed'
export type StoryTone = 'professional' | 'conversational' | 'confident'
export type StoryKind = 'jd' | 'genre'
export interface StoryPrompt {
  kind: StoryKind
  promptText: string
  length: StoryLength
  tone: StoryTone
}
export interface StoryConfig extends StoryPrompt {
  requestId: string
  experienceIds: string[]
  notes?: string
}
export interface StorySaveInput {
  content: string
  experienceIds: string[]
  prompt: StoryPrompt
  notes?: string | null
  parentStoryId?: string | null
}
export interface StoryExperienceRef {
  id: string
  title: string
}
export interface Story {
  id: string
  content: string
  prompt: StoryPrompt
  notes: string | null
  parent_story_id: string | null
  created_at: string
  experiences: StoryExperienceRef[]
}
export interface StorySummary {
  id: string
  snippet: string
  prompt: StoryPrompt
  created_at: string
  experiences: StoryExperienceRef[]
}
export interface StoryApi {
  generate: (config: StoryConfig) => Promise<void>
  cancel: (requestId: string) => Promise<void>
  save: (input: StorySaveInput) => Promise<Story>
  get: (id: string) => Promise<Story | null>
  list: () => Promise<StorySummary[]>
}
export interface ClipboardApi {
  write: (text: string) => Promise<void>
}

export type PracticeKind = 'jd' | 'genre'
export interface PracticeConfig {
  kind: PracticeKind
  promptText: string
}
export interface RubricScore {
  score: number
  note: string
}
export type RubricDimension = 'star_completeness' | 'specificity' | 'measurable_result' | 'length'
export interface InterviewFeedback {
  star_completeness: RubricScore
  specificity: RubricScore
  measurable_result: RubricScore
  length: RubricScore
  summary: string
}
export type InterviewNextKind = 'drilldown' | 'question' | 'done'
export interface PracticeStartResult {
  sessionId: string
  question: string
}
export interface PracticeAnswerResult {
  feedback: InterviewFeedback
  next_kind: InterviewNextKind
  next_text: string
  used_experience_ids: string[]
  unbanked: boolean
  used: { id: string; title: string }[]
}
export type TurnRole = 'interviewer' | 'candidate'
export interface TurnExperienceRef {
  id: string
  title: string
}
export interface PracticeTurn {
  id: string
  role: TurnRole
  content: string
  feedback: InterviewFeedback | null
  flags: { unbanked?: boolean } | null
  experiences: TurnExperienceRef[]
  created_at: string
}
export interface PracticeSession {
  id: string
  config: PracticeConfig
  started_at: string
  ended_at: string | null
  turns: PracticeTurn[]
}
export interface PracticeSessionSummary {
  id: string
  config: PracticeConfig
  started_at: string
  ended_at: string | null
  question_count: number
  answered: number
}
export interface PracticeApi {
  start: (config: PracticeConfig) => Promise<PracticeStartResult>
  answer: (sessionId: string, answer: string) => Promise<PracticeAnswerResult>
  end: (sessionId: string) => Promise<void>
  get: (sessionId: string) => Promise<PracticeSession | null>
  list: () => Promise<PracticeSessionSummary[]>
}
export type TechnicalRubricDimension = 'correctness' | 'depth' | 'tradeoffs' | 'communication'
export interface TechnicalFeedback {
  correctness: RubricScore
  depth: RubricScore
  tradeoffs: RubricScore
  communication: RubricScore
  summary: string
}
export interface TechnicalConfig {
  promptText: string
  discipline?: string
}
export interface Citation {
  chunkId: string
  title: string
}
export interface TechnicalStartResult {
  sessionId: string
  question: string
  citations: Citation[]
}
export interface TechnicalAnswerResult {
  feedback: TechnicalFeedback
  next_kind: InterviewNextKind
  next_text: string
  citations: Citation[]
}
export interface TechnicalApi {
  start: (config: TechnicalConfig) => Promise<TechnicalStartResult>
  answer: (sessionId: string, answer: string) => Promise<TechnicalAnswerResult>
}

export interface CorpusDocSummary {
  id: string
  title: string
  discipline: string | null
  chunks: number
}
export interface CorpusIngestResult {
  ok: boolean
  name: string
  error?: string
  docId?: string
  chunks?: number
}
export interface CorpusApi {
  addFiles: (paths: string[], discipline: string) => Promise<CorpusIngestResult[]>
  addUrl: (url: string, discipline: string) => Promise<CorpusIngestResult>
  list: (discipline?: string) => Promise<CorpusDocSummary[]>
  remove: (id: string) => Promise<{ deleted: boolean }>
  disciplines: () => Promise<string[]>
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

export interface StoryMatch {
  id: string
  title: string
  similarity: number
}
export interface BankApi {
  create: (input: ExperienceInput) => Promise<Experience>
  update: (id: string, input: ExperienceInput) => Promise<Experience>
  remove: (id: string) => Promise<{ deleted: boolean }>
  get: (id: string) => Promise<Experience | null>
  list: (filter: ListFilter) => Promise<ExperienceSummary[]>
  search: (filter: ListFilter) => Promise<ExperienceSummary[]>
  matchStory: (text: string) => Promise<StoryMatch | null>
  skills: () => Promise<Skill[]>
  tags: () => Promise<Tag[]>
}

export interface BackupApi {
  exportJson: () => Promise<{ saved: boolean; path?: string }>
  importJson: () => Promise<{ imported: number; canceled: boolean }>
  create: () => Promise<{ saved: boolean; path?: string }>
}

export interface Prefs {
  reminderEnabled: boolean
  reminderIntervalDays: number
  launchAtLogin: boolean
  trayResident: boolean
  onboardingDone: boolean
  reminderSnoozedAt: string | null
}

export interface Staleness {
  count: number
  daysSinceLast: number | null
}

export interface PrefsApi {
  get: () => Promise<Prefs>
  set: (patch: Partial<Prefs>) => Promise<Prefs>
}

export interface NudgeApi {
  staleness: () => Promise<Staleness>
}

export interface FeatureSpend {
  feature: string
  calls: number
  inTokens: number
  outTokens: number
  cacheReadTokens: number
  cost: number
}

export interface UsageSummary {
  byFeature: FeatureSpend[]
  totalCost: number
  totalCalls: number
}

export interface UsageApi {
  summary: () => Promise<UsageSummary>
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export interface UpdateApi {
  version: () => Promise<string>
  status: () => Promise<UpdateStatus>
  check: () => Promise<UpdateStatus>
  download: () => Promise<UpdateStatus>
  install: () => Promise<void>
  onStatus: (cb: (status: UpdateStatus) => void) => () => void
}

export interface IpcApi {
  ping: () => Promise<string>
  db: DbApi
  embed: EmbedApi
  voice: VoiceApi
  ai: AiApi
  brain: BrainApi
  ingest: IngestApi
  resume: ResumeApi
  materials: MaterialsApi
  evidence: EvidenceApi
  entity: EntityApi
  graph: GraphApi
  github: GithubApi
  story: StoryApi
  clipboard: ClipboardApi
  practice: PracticeApi
  technical: TechnicalApi
  corpus: CorpusApi
  bank: BankApi
  backup: BackupApi
  prefs: PrefsApi
  nudge: NudgeApi
  usage: UsageApi
  update: UpdateApi
}

declare global {
  interface Window {
    api: IpcApi
  }
}
