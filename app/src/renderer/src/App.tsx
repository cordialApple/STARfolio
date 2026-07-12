import { useCallback, useEffect, useState } from 'react'
import { StarRail, ThemeToggle } from './components'
import type { Experience, Skill, Tag } from './lib/bank-types'
import { BankView } from './bank/BankView'
import { ExperienceDetail } from './bank/ExperienceDetail'
import { StarForm } from './capture/StarForm'
import { BrainDump } from './capture/BrainDump'
import { ImportWizard } from './ingest/ImportWizard'
import { StoryView } from './story/StoryView'
import { PracticeView } from './practice/PracticeView'
import { TechnicalView } from './technical/TechnicalView'
import { MaterialsView } from './materials/MaterialsView'
import { SettingsView } from './settings/SettingsView'
import { IconButton } from './components'
import { Settings as SettingsIcon } from 'lucide-react'
import { cn } from './lib/cn'

type Route =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'brain' }
  | { name: 'import' }
  | { name: 'generate' }
  | { name: 'practice' }
  | { name: 'technical' }
  | { name: 'materials' }
  | { name: 'settings' }
  | { name: 'detail'; id: string }
  | { name: 'edit'; exp: Experience }

function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [reloadToken, setReloadToken] = useState(0)
  const [taxonomy, setTaxonomy] = useState<{ skills: Skill[]; tags: Tag[] }>({
    skills: [],
    tags: []
  })

  const bump = useCallback((): void => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [skills, tags] = await Promise.all([window.api.bank.skills(), window.api.bank.tags()])
      if (!cancelled) setTaxonomy({ skills, tags })
    })()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <button
            type="button"
            onClick={() => setRoute({ name: 'list' })}
            className="flex items-center gap-2.5 font-extrabold tracking-tight text-ink"
          >
            <StarRail filled={['s', 't', 'a', 'r']} variant="mark" />
            STARfolio
          </button>
          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1">
              <NavTab
                active={
                  !['generate', 'practice', 'technical', 'materials', 'settings'].includes(route.name)
                }
                onClick={() => setRoute({ name: 'list' })}
              >
                Bank
              </NavTab>
              <NavTab
                active={route.name === 'generate'}
                onClick={() => setRoute({ name: 'generate' })}
              >
                Generate
              </NavTab>
              <NavTab
                active={route.name === 'practice'}
                onClick={() => setRoute({ name: 'practice' })}
              >
                Practice
              </NavTab>
              <NavTab
                active={route.name === 'technical'}
                onClick={() => setRoute({ name: 'technical' })}
              >
                Technical
              </NavTab>
              <NavTab
                active={route.name === 'materials'}
                onClick={() => setRoute({ name: 'materials' })}
              >
                Resume
              </NavTab>
            </nav>
            <IconButton
              label="Settings"
              size="sm"
              onClick={() => setRoute({ name: 'settings' })}
              className={cn(route.name === 'settings' && 'bg-raised')}
            >
              <SettingsIcon className="size-4" />
            </IconButton>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="px-6 py-8">
        {route.name === 'list' && (
          <BankView
            reloadToken={reloadToken}
            onOpen={(id) => setRoute({ name: 'detail', id })}
            onNew={() => setRoute({ name: 'new' })}
            onBrainDump={() => setRoute({ name: 'brain' })}
            onImport={() => setRoute({ name: 'import' })}
          />
        )}

        {route.name === 'generate' && <StoryView />}

        {route.name === 'practice' && <PracticeView />}

        {route.name === 'technical' && <TechnicalView />}

        {route.name === 'materials' && <MaterialsView />}

        {route.name === 'settings' && <SettingsView />}

        {route.name === 'brain' && (
          <BrainDump
            skills={taxonomy.skills}
            tags={taxonomy.tags}
            onExit={() => setRoute({ name: 'list' })}
            onSaved={(id) => {
              bump()
              setRoute({ name: 'detail', id })
            }}
          />
        )}

        {route.name === 'import' && (
          <ImportWizard
            skills={taxonomy.skills}
            tags={taxonomy.tags}
            onExit={() => {
              bump()
              setRoute({ name: 'list' })
            }}
            onSaved={(id) => {
              bump()
              setRoute({ name: 'detail', id })
            }}
          />
        )}

        {route.name === 'new' && (
          <StarForm
            skills={taxonomy.skills}
            tags={taxonomy.tags}
            onCancel={() => setRoute({ name: 'list' })}
            onSaved={(exp) => {
              bump()
              setRoute({ name: 'detail', id: exp.id })
            }}
          />
        )}

        {route.name === 'edit' && (
          <StarForm
            initial={route.exp}
            skills={taxonomy.skills}
            tags={taxonomy.tags}
            onCancel={() => setRoute({ name: 'detail', id: route.exp.id })}
            onSaved={(exp) => {
              bump()
              setRoute({ name: 'detail', id: exp.id })
            }}
          />
        )}

        {route.name === 'detail' && (
          <ExperienceDetail
            id={route.id}
            onBack={() => setRoute({ name: 'list' })}
            onEdit={(exp) => setRoute({ name: 'edit', exp })}
            onDeleted={() => {
              bump()
              setRoute({ name: 'list' })
            }}
            onChanged={bump}
            onOpen={(id) => setRoute({ name: 'detail', id })}
          />
        )}
      </main>
    </div>
  )
}

function NavTab({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

export default App
