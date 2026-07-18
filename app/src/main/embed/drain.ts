export interface EmbedDrainerDeps<Id, Vec> {
  nextPending: () => Id | undefined
  resolveText: (id: Id) => string | null
  embed: (text: string) => Promise<Vec>
  store: (id: Id, vector: Vec) => void
  drop: (id: Id) => void
  retryMs?: number
}

export interface EmbedDrainer {
  kick: () => void
}

// Drains a queue in the background: pull the oldest pending id, resolve its passage,
// embed, persist, delete. A missing/failed model leaves rows queued and retries later,
// so capture never breaks when embeddings are unavailable. A null passage is dropped.
export function createEmbedDrainer<Id, Vec>(deps: EmbedDrainerDeps<Id, Vec>): EmbedDrainer {
  const retryMs = deps.retryMs ?? 30_000
  let draining = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const kick = (): void => {
    if (draining) return
    draining = true
    void (async () => {
      try {
        for (;;) {
          const id = deps.nextPending()
          if (id === undefined) break
          const text = deps.resolveText(id)
          if (text === null) {
            deps.drop(id)
            continue
          }
          deps.store(id, await deps.embed(text))
          deps.drop(id)
        }
      } catch {
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null
            kick()
          }, retryMs)
        }
      } finally {
        draining = false
      }
    })()
  }

  return { kick }
}
