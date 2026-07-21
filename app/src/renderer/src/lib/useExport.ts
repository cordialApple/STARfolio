import { useState } from 'react'
import { useToast } from '../components'

export interface UseExport {
  copy: () => Promise<void>
  exportAs: (format: 'md' | 'docx') => Promise<void>
  busy: 'md' | 'docx' | null
}

export function useExport(
  buildMarkdown: () => string | null,
  buildFilename: () => string,
  copyLabel: string
): UseExport {
  const [busy, setBusy] = useState<'md' | 'docx' | null>(null)
  const toast = useToast()

  async function copy(): Promise<void> {
    const md = buildMarkdown()
    if (md === null) return
    try {
      await window.api.clipboard.write(md)
      toast(`${copyLabel} copied to clipboard.`, 'success')
    } catch (err) {
      toast(`Could not copy: ${(err as Error).message}`, 'danger')
    }
  }

  async function exportAs(format: 'md' | 'docx'): Promise<void> {
    const md = buildMarkdown()
    if (md === null) return
    setBusy(format)
    try {
      const res = await window.api.materials.export(md, format, buildFilename())
      if (res.saved) toast(`Saved to ${res.path}`, 'success')
    } catch (err) {
      toast(`Could not export: ${(err as Error).message}`, 'danger')
    } finally {
      setBusy(null)
    }
  }

  return { copy, exportAs, busy }
}
