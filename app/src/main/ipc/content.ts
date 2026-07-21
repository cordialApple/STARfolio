import { z } from 'zod'
import { clipboard, type IpcMain } from 'electron'
import { handle, idArg, nonEmpty, saveDialog } from './shared'
import { exportResume } from './export-resume'
import { streamStory, storyConfig } from '../ai/story'
import { cancelStream } from '../ai/client'
import { generateBullets } from '../ai/bullets'
import { saveStory, getStory, listStories, storySaveInput } from '../db/repositories/stories'
import { markdownToDocx } from '../export/docx'
import { writeFileSync } from 'fs'

const copyArg = z.object({ text: z.string().max(50_000) })

export function registerContent(ipcMain: IpcMain): void {
  handle(ipcMain, 'story:generate', storyConfig, (event, config) => streamStory(config, event.sender))
  handle(ipcMain, 'story:cancel', nonEmpty, (_e, requestId) => cancelStream(requestId))
  const bulletsArg = z.object({
    jdText: z.string().trim().min(1).max(20_000),
    experienceIds: z.array(z.string().min(1).max(64)).min(1).max(20)
  })
  handle(ipcMain, 'bullets:generate', bulletsArg, (_e, { jdText, experienceIds }) =>
    generateBullets(jdText, experienceIds)
  )
  const exportArg = z.object({
    markdown: z.string().min(1).max(100_000),
    format: z.enum(['md', 'docx']),
    filename: z.string().trim().max(120).default('resume')
  })
  handle(ipcMain, 'resume:export', exportArg, (_e, input) =>
    exportResume({ saveDialog, writeFile: writeFileSync, toDocx: markdownToDocx }, input)
  )

  handle(ipcMain, 'story:save', storySaveInput, (_e, input) => saveStory(input))
  handle(ipcMain, 'story:get', idArg, (_e, { id }) => getStory(id))
  ipcMain.handle('story:list', () => listStories())

  handle(ipcMain, 'clipboard:write', copyArg, (_e, { text }) => clipboard.writeText(text))
}
