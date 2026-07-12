import { useCallback, useEffect, useState } from 'react'
import { StarRail, ThemeToggle } from './components'
import type { Experience, Skill, Tag } from './lib/bank-types'
import { BankView } from './bank/BankView'
import { ExperienceDetail } from './bank/ExperienceDetail'
import { StarForm } from './capture/StarForm'
import { BrainDump } from './capture/BrainDump'

type Route =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'brain' }
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
          <ThemeToggle />
        </div>
      </header>

      <main className="px-6 py-8">
        {route.name === 'list' && (
          <BankView
            reloadToken={reloadToken}
            onOpen={(id) => setRoute({ name: 'detail', id })}
            onNew={() => setRoute({ name: 'new' })}
            onBrainDump={() => setRoute({ name: 'brain' })}
          />
        )}

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
          />
        )}
      </main>
    </div>
  )
}

export default App
