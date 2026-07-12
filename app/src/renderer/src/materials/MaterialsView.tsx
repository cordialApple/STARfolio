import { useMemo, useState } from 'react'
import { FileDown, Copy, Sparkles, FileText } from 'lucide-react'
import { Button, Card, Input, Textarea, useToast } from '../components'
import type { ResumeBullet } from '../lib/bank-types'

const MAX_SOURCES = 10

function buildMarkdown(name: string, contact: string, bullets: ResumeBullet[]): string {
  const lines: string[] = []
  if (name.trim()) lines.push(`# ${name.trim()}`)
  if (contact.trim()) lines.push(contact.trim())
  lines.push('', '## Experience')
  for (const b of bullets) lines.push(`- ${b.text}`)
  return lines.join('\n')
}

export function MaterialsView(): React.JSX.Element {
  const [jd, setJd] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [bullets, setBullets] = useState<ResumeBullet[] | null>(null)
  const [kept, setKept] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()

  const keptBullets = useMemo(
    () => (bullets ? bullets.filter((_, i) => kept.has(i)) : []),
    [bullets, kept]
  )
  const markdown = useMemo(() => buildMarkdown(name, contact, keptBullets), [name, contact, keptBullets])

  async function generate(): Promise<void> {
    if (!jd.trim()) return
    setBusy('generate')
    try {
      const matches = await window.api.bank.search({ query: jd.trim(), status: 'confirmed' })
      const ids = matches.slice(0, MAX_SOURCES).map((m) => m.id)
      if (ids.length === 0) {
        toast('No confirmed experiences to draw from — confirm some in your bank first.', 'neutral')
        return
      }
      const result = await window.api.materials.bullets(jd.trim(), ids)
      if (result.length === 0) {
        toast('Could not draft bullets from your bank for this role.', 'danger')
        return
      }
      setBullets(result)
      setKept(new Set(result.map((_, i) => i)))
    } catch (err) {
      toast((err as Error).message, 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function exportAs(format: 'md' | 'docx'): Promise<void> {
    setBusy(format)
    try {
      const res = await window.api.materials.export(markdown, format, name || 'resume')
      if (res.saved) toast(`Saved to ${res.path}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'danger')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Resume bullets</h1>
        <p className="text-sm text-muted">
          Paste a job description — we draft resume bullets from your confirmed experiences, each
          traceable to the experience it came from.
        </p>
      </div>

      <Card title="Job description">
        <div className="space-y-3">
          <Textarea
            rows={5}
            placeholder="Paste the job description…"
            value={jd}
            onChange={(e) => setJd(e.target.value)}
          />
          <Button onClick={() => void generate()} loading={busy === 'generate'} disabled={!jd.trim()}>
            <Sparkles className="size-4" />
            Draft bullets
          </Button>
        </div>
      </Card>

      {bullets && (
        <>
          <Card title="Tailored bullets">
            <ul className="space-y-2">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={kept.has(i)}
                    onChange={() =>
                      setKept((prev) => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i)
                        else next.add(i)
                        return next
                      })
                    }
                    className="mt-1 size-4 accent-fg-brand"
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{b.text}</p>
                    <span
                      className="mt-1 inline-flex items-center gap-1 rounded-pill bg-raised px-2 py-0.5 text-xs text-faint"
                      title="Traceable to this banked experience"
                    >
                      <FileText className="size-3" />
                      {b.experienceTitle}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Assemble & export">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                  placeholder="email · phone · site"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 text-xs text-ink">
                {markdown}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void window.api.clipboard.write(markdown).then(() => toast('Copied.', 'neutral'))}
                  disabled={keptBullets.length === 0}
                >
                  <Copy className="size-4" />
                  Copy markdown
                </Button>
                <Button variant="secondary" onClick={() => void exportAs('md')} loading={busy === 'md'} disabled={keptBullets.length === 0}>
                  <FileDown className="size-4" />
                  Export .md
                </Button>
                <Button onClick={() => void exportAs('docx')} loading={busy === 'docx'} disabled={keptBullets.length === 0}>
                  <FileDown className="size-4" />
                  Export .docx
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
