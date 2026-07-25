export const STT_SAMPLE_RATE = 24000
export const BLOCK_SAMPLES = 1920
export const ASR_DELAY_TOKENS = 6
export const PAUSE_HEAD_INDEX = 2
export const EOT_THRESHOLD = 0.5

export interface AudioIn {
  type: 'Audio'
  pcm: number[]
}
export interface MarkerIn {
  type: 'Marker'
  id: number
}
export interface InitIn {
  type: 'Init'
}
export type InMsg = AudioIn | MarkerIn | InitIn

export interface ReadyOut {
  type: 'Ready'
}
export interface WordOut {
  type: 'Word'
  text: string
  start_time: number
}
export interface EndWordOut {
  type: 'EndWord'
  stop_time: number
}
export interface StepOut {
  type: 'Step'
  step_idx: number
  prs: number[]
  buffered_pcm?: number
}
export interface MarkerOut {
  type: 'Marker'
  id: number
}
export interface ErrorOut {
  type: 'Error'
  message: string
}
export type OutMsg = ReadyOut | WordOut | EndWordOut | StepOut | MarkerOut | ErrorOut

export function isEndOfTurn(step: StepOut): boolean {
  return (step.prs[PAUSE_HEAD_INDEX] ?? 0) > EOT_THRESHOLD
}

export function eotPrs(margin = 0.1): number[] {
  const prs = new Array(PAUSE_HEAD_INDEX + 1).fill(0)
  prs[PAUSE_HEAD_INDEX] = EOT_THRESHOLD + margin
  return prs
}
