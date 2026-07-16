import type { IpcMain, WebContents } from 'electron'
import { VoiceStreamSession, defaultFrameSourceConfig } from './streaming'
import { transcribeSamples } from './index'

const sessions = new Map<number, VoiceStreamSession>()

function open(sender: WebContents): void {
  sessions.get(sender.id)?.close()
  sessions.set(
    sender.id,
    new VoiceStreamSession(
      (event) => {
        if (!sender.isDestroyed()) sender.send('voice:utterance', event)
      },
      defaultFrameSourceConfig(),
      {
        decode: (samples) => transcribeSamples(samples),
        onTranscript: (event) => {
          if (!sender.isDestroyed()) sender.send('voice:partial', event)
        }
      }
    )
  )
  sender.once('destroyed', () => close(sender.id))
}

function close(senderId: number): void {
  sessions.get(senderId)?.close()
  sessions.delete(senderId)
}

export function registerVoiceStream(ipcMain: IpcMain): void {
  ipcMain.on('voice:streamStart', (e) => open(e.sender))
  ipcMain.on('voice:frames', (e, frames: Float32Array) => {
    sessions.get(e.sender.id)?.pushFrames(frames)
  })
  ipcMain.on('voice:ttsStart', (e) => sessions.get(e.sender.id)?.onTtsStart())
  ipcMain.on('voice:ttsEnd', (e) => sessions.get(e.sender.id)?.onTtsEnd())
  ipcMain.on('voice:streamStop', (e) => close(e.sender.id))
}
