import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import { cn } from '../lib/cn'

export type ToastTone = 'success' | 'danger' | 'info' | 'neutral'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

const icons: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  danger: XCircle,
  info: Info,
  neutral: AlertTriangle
}

const accents: Record<ToastTone, string> = {
  success: 'text-fg-success',
  danger: 'text-fg-danger',
  info: 'text-fg-info',
  neutral: 'text-muted'
}

const ToastContext = createContext<{
  toast: (message: string, tone?: ToastTone) => void
} | null>(null)

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const toast = useCallback((message: string, tone: ToastTone = 'neutral'): void => {
    const id = nextId.current++
    setItems((prev) => [...prev, { id, message, tone }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((t) => {
          const Icon = icons[t.tone]
          return (
            <div
              key={t.id}
              role={t.tone === 'danger' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-ink shadow-pop"
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', accents[t.tone])} />
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.toast
}
