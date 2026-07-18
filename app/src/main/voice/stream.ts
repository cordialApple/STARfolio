import type { IpcMain, WebContents } from 'electron'
import { RollingTranscript, VoiceStreamSession, defaultFrameSourceConfig } from './streaming'
import { transcribeSamples } from './index'
import { steerFromTranscript } from '../ai/session'
import {
  STEERING_CADENCE_MS,
  STEERING_WINDOW_MS,
  startSteeringLoop,
  type SteeringHandle
} from '../ai/steering'

interface StreamEntry {
  session: VoiceStreamSession
  transcript: RollingTranscript
  steering?: SteeringHandle
}

const sessions = new Map<number, StreamEntry>()

export function rollingTranscriptFor(senderId: number): RollingTranscript | undefined {
  return sessions.get(senderId)?.transcript
}

function startSteering(sessionId: string, transcript: RollingTranscript): SteeringHandle {
  return startSteeringLoop({
    sessionId,
    view: () => ({ text: transcript.recent(STEERING_WINDOW_MS, Date.now()).text }),
    evaluate: (text) => steerFromTranscript(sessionId, text),
    cadence: STEERING_CADENCE_MS
  })
}

function teardown(entry: StreamEntry | undefined): void {
  if (!entry) return
  entry.session.close()
  entry.steering?.dispose()
}

function open(sender: WebContents, sessionId?: string): void {
  teardown(sessions.get(sender.id))
  const transcript = new RollingTranscript()
  const session = new VoiceStreamSession(
    (event) => {
      if (!sender.isDestroyed()) sender.send('voice:utterance', event)
    },
    defaultFrameSourceConfig(),
    {
      decode: (samples) => transcribeSamples(samples),
      onTranscript: (event) => {
        transcript.push(event, Date.now())
        if (!sender.isDestroyed()) sender.send('voice:partial', event)
      }
    }
  )
  const entry: StreamEntry = { session, transcript }
  if (sessionId) entry.steering = startSteering(sessionId, transcript)
  sessions.set(sender.id, entry)
  sender.once('destroyed', () => close(sender.id))
}

function close(senderId: number): void {
  teardown(sessions.get(senderId))
  sessions.delete(senderId)
}

export function registerVoiceStream(ipcMain: IpcMain): void {
  ipcMain.on('voice:streamStart', (e, sessionId?: string) =>
    open(e.sender, typeof sessionId === 'string' ? sessionId : undefined)
  )
  ipcMain.on('voice:frames', (e, frames: Float32Array) => {
    sessions.get(e.sender.id)?.session.pushFrames(frames)
  })
  ipcMain.on('voice:ttsStart', (e) => {
    const entry = sessions.get(e.sender.id)
    entry?.session.onTtsStart()
    entry?.steering?.loop.reset()
  })
  ipcMain.on('voice:ttsEnd', (e) => sessions.get(e.sender.id)?.session.onTtsEnd())
  ipcMain.on('voice:streamStop', (e) => close(e.sender.id))
}
