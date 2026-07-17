import type { IpcMain, WebContents } from 'electron'
import { RollingTranscript, VoiceStreamSession, defaultFrameSourceConfig } from './streaming'
import { transcribeSamples } from './index'

interface StreamEntry {
  session: VoiceStreamSession
  transcript: RollingTranscript
}

const sessions = new Map<number, StreamEntry>()

export function rollingTranscriptFor(senderId: number): RollingTranscript | undefined {
  return sessions.get(senderId)?.transcript
}

function open(sender: WebContents): void {
  sessions.get(sender.id)?.session.close()
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
  sessions.set(sender.id, { session, transcript })
  sender.once('destroyed', () => close(sender.id))
}

function close(senderId: number): void {
  sessions.get(senderId)?.session.close()
  sessions.delete(senderId)
}

export function registerVoiceStream(ipcMain: IpcMain): void {
  ipcMain.on('voice:streamStart', (e) => open(e.sender))
  ipcMain.on('voice:frames', (e, frames: Float32Array) => {
    sessions.get(e.sender.id)?.session.pushFrames(frames)
  })
  ipcMain.on('voice:ttsStart', (e) => sessions.get(e.sender.id)?.session.onTtsStart())
  ipcMain.on('voice:ttsEnd', (e) => sessions.get(e.sender.id)?.session.onTtsEnd())
  ipcMain.on('voice:streamStop', (e) => close(e.sender.id))
}
