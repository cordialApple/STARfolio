import { useState } from 'react'
import { Inbox, Plus, Search, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CadenceNudge,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Select,
  Skeleton,
  Spinner,
  StarRail,
  Textarea,
  ThemeToggle,
  Toggle,
  useToast,
  type BadgeTone,
  type StarBeat
} from '../components'

const badgeTones: BadgeTone[] = [
  'neutral',
  'brand',
  'success',
  'warning',
  'danger',
  'info',
  's',
  't',
  'a',
  'r'
]

const swatches: { name: string; className: string }[] = [
  { name: 'canvas', className: 'bg-canvas border border-line' },
  { name: 'surface', className: 'bg-surface border border-line' },
  { name: 'raised', className: 'bg-raised border border-line' },
  { name: 'brand', className: 'bg-brand' },
  { name: 'pop', className: 'bg-pop' },
  { name: 'star-s', className: 'bg-star-s' },
  { name: 'star-t', className: 'bg-star-t' },
  { name: 'star-a', className: 'bg-star-a' },
  { name: 'star-r', className: 'bg-star-r' },
  { name: 'danger', className: 'bg-danger' }
]

function Row({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-faint">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

function Gallery(): React.JSX.Element {
  const [on, setOn] = useState(true)
  const [checked, setChecked] = useState(true)
  const [open, setOpen] = useState(false)
  const [beats, setBeats] = useState<StarBeat[]>(['s', 't'])
  const toast = useToast()

  return (
    <div className="space-y-8 rounded-2xl border border-line bg-canvas p-6 text-ink">
      <Row title="Type scale">
        <div className="space-y-1">
          <p className="text-2xl font-extrabold">Display — Nunito Variable</p>
          <p className="text-base">Body text sets the friendly, readable tone.</p>
          <p className="font-mono text-sm text-muted">JetBrains Mono · 384-dim · v0.1</p>
        </div>
      </Row>

      <Row title="Color tokens">
        {swatches.map((s) => (
          <div key={s.name} className="flex flex-col items-center gap-1">
            <span className={`size-10 rounded-lg ${s.className}`} />
            <span className="text-xs text-faint">{s.name}</span>
          </div>
        ))}
      </Row>

      <Row title="Buttons">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">
          <Plus className="size-4" /> Large
        </Button>
      </Row>

      <Row title="Icon buttons">
        <IconButton label="Search">
          <Search className="size-4" />
        </IconButton>
        <IconButton label="Add" variant="surface">
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Delete" disabled>
          <Trash2 className="size-4" />
        </IconButton>
      </Row>

      <Row title="Inputs">
        <Input placeholder="Default input" className="max-w-56" />
        <Input placeholder="Invalid" invalid className="max-w-56" />
        <Input placeholder="Disabled" disabled className="max-w-56" />
        <Select defaultValue="a" className="max-w-40">
          <option value="a">Option A</option>
          <option value="b">Option B</option>
        </Select>
      </Row>

      <Row title="Textarea">
        <Textarea rows={2} placeholder="Multi-line input" className="max-w-md" />
      </Row>

      <Row title="Selection controls">
        <Checkbox label="Checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <Checkbox label="Disabled" disabled />
        <Toggle checked={on} onCheckedChange={setOn} label="Toggle setting" />
      </Row>

      <Row title="Badges">
        {badgeTones.map((t) => (
          <Badge key={t} tone={t}>
            {t}
          </Badge>
        ))}
      </Row>

      <Row title="STAR rail — signature">
        <div className="flex items-center gap-2">
          {(['s', 't', 'a', 'r'] as StarBeat[]).map((b) => (
            <Checkbox
              key={b}
              label={b.toUpperCase()}
              checked={beats.includes(b)}
              onChange={(e) =>
                setBeats((prev) =>
                  e.target.checked ? [...prev, b] : prev.filter((x) => x !== b)
                )
              }
            />
          ))}
        </div>
        <div className="w-48">
          <StarRail filled={beats} variant="inline" />
        </div>
        <div className="h-12">
          <StarRail filled={beats} variant="gutter" />
        </div>
        <StarRail filled={beats} variant="mark" className="[&>span]:size-4" />
      </Row>

      <Row title="Feedback">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Button variant="secondary" onClick={() => toast('Saved to your bank.', 'success')}>
          Fire toast
        </Button>
        <CadenceNudge count={3} />
        <Spinner />
      </Row>

      <Row title="Loading">
        <div className="w-64 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Row>

      <div className="grid gap-4 md:grid-cols-2">
        <EmptyState
          icon={Inbox}
          title="No experiences yet"
          description="Log your first accomplishment to start building your bank."
          action={
            <Button size="sm">
              <Plus className="size-4" /> Add experience
            </Button>
          }
        />
        <ErrorState
          description="We could not reach the model. Check your API key and try again."
          action={
            <Button size="sm" variant="secondary">
              Retry
            </Button>
          }
        />
      </div>

      <Card title="Card primitive" action={<Badge tone="brand">Live</Badge>}>
        <p className="text-sm text-muted">
          Cards wrap content with a titled header, a border, and elevation from tokens.
        </p>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Dialog primitive"
        description="Native modal — Esc, backdrop click, and focus trap come for free."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Confirm</Button>
          </>
        }
      >
        <p>Focus is trapped here while open, and returns to the trigger on close.</p>
      </Dialog>
    </div>
  )
}

export function Preview(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-canvas p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">STARfolio design system</h1>
          <p className="text-sm text-muted">
            Every primitive and state, side by side in light and dark. Reduced motion follows your OS
            setting.
          </p>
        </div>
        <ThemeToggle />
      </header>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-faint">Light</h2>
          <Gallery />
        </section>
        <section className="dark space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-faint">Dark</h2>
          <Gallery />
        </section>
      </div>
    </div>
  )
}
