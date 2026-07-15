import { useCallback, useEffect, useState } from 'react'
import { StarRail, StalenessBanner } from './components'
import type { Experience, Skill, Tag } from './lib/bank-types'
import { BankView } from './bank/BankView'
import { ExperienceDetail } from './bank/ExperienceDetail'
import { StarForm } from './capture/StarForm'
import { BrainDump } from './capture/BrainDump'
import { ImportWizard } from './ingest/ImportWizard'
import { StoryView } from './story/StoryView'
import { PracticeView } from './practice/PracticeView'
import { TechnicalView } from './technical/TechnicalView'
import { InterviewView } from './interview/InterviewView'
import { MaterialsView } from './materials/MaterialsView'
import { SettingsView } from './settings/SettingsView'
import { Onboarding } from './onboarding/Onboarding'
import {
  Settings as SettingsIcon,
  MessagesSquare,
  Sparkles,
  Code2,
  UserRoundCheck,
  FileText,
  Library
} from 'lucide-react'
import { cn } from './lib/cn'

type Route =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'brain' }
  | { name: 'import' }
  | { name: 'generate' }
  | { name: 'practice' }
  | { name: 'technical' }
  | { name: 'interview' }
  | { name: 'materials' }
  | { name: 'settings' }
  | { name: 'detail'; id: string }
  | { name: 'edit'; exp: Experience }

const NAV_TABS: {
  route: Route
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { route: { name: 'practice' }, label: 'Practice', icon: MessagesSquare },
  { route: { name: 'generate' }, label: 'Generate', icon: Sparkles },
  { route: { name: 'technical' }, label: 'Technical', icon: Code2 },
  { route: { name: 'interview' }, label: 'Interview', icon: UserRoundCheck },
  { route: { name: 'materials' }, label: 'Resume', icon: FileText },
  { route: { name: 'list' }, label: 'Bank', icon: Library }
]

function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>({ name: 'practice' })
  const [onboarding, setOnboarding] = useState<boolean | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [taxonomy, setTaxonomy] = useState<{ skills: Skill[]; tags: Tag[] }>({
    skills: [],
    tags: []
  })

  const bump = useCallback((): void => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    void window.api.prefs.get().then((p) => setOnboarding(!p.onboardingDone))
  }, [])

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

  if (onboarding === null) {
    return <div className="min-h-screen bg-canvas" />
  }

  if (onboarding) {
    return (
      <Onboarding
        onStartBrainDump={() => {
          setOnboarding(false)
          setRoute({ name: 'brain' })
        }}
        onExplore={() => setOnboarding(false)}
      />
    )
  }

  const bankActive = ![
    'generate',
    'practice',
    'technical',
    'interview',
    'materials',
    'settings'
  ].includes(route.name)

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-canvas/85 px-3 py-5 backdrop-blur">
        <div className="flex items-center gap-2.5 px-2 pb-5 font-extrabold tracking-tight text-ink">
          <StarRail filled={['s', 't', 'a', 'r']} variant="mark" />
          STARfolio
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_TABS.map((tab) => (
            <NavTab
              key={tab.label}
              icon={tab.icon}
              active={tab.route.name === 'list' ? bankActive : route.name === tab.route.name}
              onClick={() => setRoute(tab.route)}
            >
              {tab.label}
            </NavTab>
          ))}
        </nav>

        <NavTab
          icon={SettingsIcon}
          active={route.name === 'settings'}
          onClick={() => setRoute({ name: 'settings' })}
          className="mt-auto"
        >
          Settings
        </NavTab>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8">
        {route.name === 'list' && (
          <>
            <StalenessBanner reloadToken={reloadToken} onNew={() => setRoute({ name: 'new' })} />
            <BankView
              reloadToken={reloadToken}
              onOpen={(id) => setRoute({ name: 'detail', id })}
              onNew={() => setRoute({ name: 'new' })}
              onBrainDump={() => setRoute({ name: 'brain' })}
              onImport={() => setRoute({ name: 'import' })}
            />
          </>
        )}

        {route.name === 'generate' && <StoryView />}

        {route.name === 'practice' && <PracticeView />}

        {route.name === 'technical' && <TechnicalView />}

        {route.name === 'interview' && <InterviewView />}

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
  icon: Icon,
  className,
  children
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
        active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
        className
      )}
    >
      <Icon className="size-4 shrink-0" />
      {children}
    </button>
  )
}

export default App
