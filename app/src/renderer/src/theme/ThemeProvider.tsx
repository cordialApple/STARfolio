import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { normalizeMode, nextMode, resolveMode, type ThemeMode } from './theme-logic'

export type { ThemeMode }

const STORAGE_KEY = 'starfolio-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

type ThemeContextValue = {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  cycleMode: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStored(): ThemeMode {
  return normalizeMode(localStorage.getItem(STORAGE_KEY))
}

function writeStored(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

function systemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(readStored)
  const [systemIsDark, setSystemIsDark] = useState<boolean>(systemDark)

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (): void => setSystemIsDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveMode(mode, systemIsDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const setMode = useCallback((next: ThemeMode): void => {
    writeStored(next)
    setModeState(next)
  }, [])

  const cycleMode = useCallback((): void => {
    setModeState((prev) => {
      const next = nextMode(prev)
      writeStored(next)
      return next
    })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, cycleMode }),
    [mode, resolved, setMode, cycleMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
