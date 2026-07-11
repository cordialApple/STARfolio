import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream, renameSync, rmSync } from 'fs'
import { Readable } from 'stream'

const MODEL_URLS: Record<string, string> = {
  'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
}

// Minimal Stage-0 model manager: download the ggml whisper model to userData once, atomically.
// Stage 5 replaces this with the shared model manager (progress/retry/resume) from the retrieval spec.
export async function ensureWhisperModel(name: string): Promise<string> {
  const url = MODEL_URLS[name]
  if (!url) throw new Error(`unknown whisper model: ${name}`)
  const dir = join(app.getPath('userData'), 'models', 'whisper')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `ggml-${name}.bin`)
  if (existsSync(dest)) return dest

  const tmp = `${dest}.download`
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`whisper model download failed: ${res.status}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const file = createWriteStream(tmp)
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
        .pipe(file)
        .on('finish', () => resolve())
        .on('error', reject)
    })
    renameSync(tmp, dest)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  return dest
}
