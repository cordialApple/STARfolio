import { createWriteStream, renameSync, rmSync } from 'fs'

export async function downloadToFile(
  url: string,
  dest: string,
  onProgress: (pct: number) => void,
  expectedBytes = 0
): Promise<void> {
  const tmp = `${dest}.download`
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  const total = Number(res.headers.get('content-length')) || expectedBytes
  const file = createWriteStream(tmp)
  let loaded = 0
  let lastPct = -1
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.length
      if (!file.write(value)) await new Promise<void>((r) => file.once('drain', () => r()))
      const pct = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0
      if (pct !== lastPct) {
        lastPct = pct
        onProgress(pct)
      }
    }
    await new Promise<void>((resolve, reject) => file.end(() => resolve()).on('error', reject))
    renameSync(tmp, dest)
  } catch (err) {
    // Wait for the fd to actually close before unlinking — on Windows rmSync can EBUSY against a
    // still-closing handle.
    await new Promise<void>((resolve) => {
      if (file.destroyed) return resolve()
      file.once('close', () => resolve())
      file.destroy()
    })
    rmSync(tmp, { force: true })
    throw err
  }
}
