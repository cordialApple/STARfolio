export const TTS_SAMPLE_RATE = 24000

export interface TextIn {
  type: 'Text'
  text: string
}
export interface MarkerIn {
  type: 'Marker'
  id: number
}
export type TtsInMsg = TextIn | MarkerIn

export interface ReadyOut {
  type: 'Ready'
}
export interface AudioOut {
  type: 'Audio'
  pcm: number[]
}
export interface MarkerOut {
  type: 'Marker'
  id: number
}
export interface ErrorOut {
  type: 'Error'
  message: string
}
export type TtsOutMsg = ReadyOut | AudioOut | MarkerOut | ErrorOut
