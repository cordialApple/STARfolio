export interface SaveDialogOptions {
  defaultPath: string
  filters: { name: string; extensions: string[] }[]
}

export interface ExportResumeDeps {
  saveDialog: (opts: SaveDialogOptions) => Promise<string | null>
  writeFile: (path: string, data: string | Uint8Array) => void
  toDocx: (markdown: string) => Uint8Array
}

export type ExportResumeInput = { markdown: string; format: 'md' | 'docx'; filename: string }
export type ExportResumeResult = { saved: false } | { saved: true; path: string }

export async function exportResume(
  deps: ExportResumeDeps,
  { markdown, format, filename }: ExportResumeInput
): Promise<ExportResumeResult> {
  const safe = filename.replace(/[^\w.-]+/g, '-') || 'resume'
  const path = await deps.saveDialog({
    defaultPath: `${safe}.${format}`,
    filters: [{ name: format === 'docx' ? 'Word document' : 'Markdown', extensions: [format] }]
  })
  if (!path) return { saved: false }
  deps.writeFile(path, format === 'docx' ? deps.toDocx(markdown) : Buffer.from(markdown, 'utf8'))
  return { saved: true, path }
}
