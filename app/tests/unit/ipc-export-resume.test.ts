import { describe, it, expect, vi } from 'vitest'
import { exportResume, type ExportResumeDeps } from '../../src/main/ipc/export-resume'

function makeDeps(over: Partial<ExportResumeDeps> = {}): { deps: ExportResumeDeps; saved: [string, string | Uint8Array][] } {
  const saved: [string, string | Uint8Array][] = []
  const deps: ExportResumeDeps = {
    saveDialog: vi.fn(async () => '/out/resume.md'),
    writeFile: vi.fn((path, data) => {
      saved.push([path, data])
    }),
    toDocx: vi.fn(() => new Uint8Array([7, 8, 9])),
    ...over
  }
  return { deps, saved }
}

describe('exportResume', () => {
  it('sanitizes the filename and offers it as the default path with a matching filter', async () => {
    const saveDialog = vi.fn(async () => '/out/my-resume.md')
    const { deps } = makeDeps({ saveDialog })
    await exportResume(deps, { markdown: '# hi', format: 'md', filename: 'my resume!!' })
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: 'my-resume-.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
  })

  it('writes markdown as a utf8 buffer and reports the saved path', async () => {
    const { deps, saved } = makeDeps({ saveDialog: vi.fn(async () => '/out/r.md') })
    const r = await exportResume(deps, { markdown: '# hi', format: 'md', filename: 'r' })
    expect(r).toEqual({ saved: true, path: '/out/r.md' })
    expect(saved[0][0]).toBe('/out/r.md')
    expect(saved[0][1]).toEqual(Buffer.from('# hi', 'utf8'))
    expect(deps.toDocx).not.toHaveBeenCalled()
  })

  it('renders docx bytes through toDocx and uses the docx filter', async () => {
    const saveDialog = vi.fn(async () => '/out/r.docx')
    const { deps, saved } = makeDeps({ saveDialog })
    const r = await exportResume(deps, { markdown: '# hi', format: 'docx', filename: 'r' })
    expect(r).toEqual({ saved: true, path: '/out/r.docx' })
    expect(deps.toDocx).toHaveBeenCalledWith('# hi')
    expect(saved[0][1]).toEqual(new Uint8Array([7, 8, 9]))
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: 'r.docx',
      filters: [{ name: 'Word document', extensions: ['docx'] }]
    })
  })

  it('falls back to "resume" when the sanitized filename is empty', async () => {
    const saveDialog = vi.fn(async () => '/out/resume.md')
    const { deps } = makeDeps({ saveDialog })
    await exportResume(deps, { markdown: '# hi', format: 'md', filename: '' })
    expect(saveDialog).toHaveBeenCalledWith({
      defaultPath: 'resume.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
  })

  it('returns unsaved and writes nothing when the dialog is canceled', async () => {
    const { deps, saved } = makeDeps({ saveDialog: vi.fn(async () => null) })
    const r = await exportResume(deps, { markdown: '# hi', format: 'md', filename: 'r' })
    expect(r).toEqual({ saved: false })
    expect(saved).toHaveLength(0)
    expect(deps.writeFile).not.toHaveBeenCalled()
  })
})
