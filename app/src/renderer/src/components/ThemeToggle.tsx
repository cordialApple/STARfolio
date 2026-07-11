import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeMode } from '../theme/ThemeProvider'
import { IconButton } from './IconButton'

const icons: Record<ThemeMode, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon
}

const nextLabel: Record<ThemeMode, string> = {
  system: 'Switch to light theme',
  light: 'Switch to dark theme',
  dark: 'Switch to system theme'
}

export function ThemeToggle(): React.JSX.Element {
  const { mode, cycleMode } = useTheme()
  const Icon = icons[mode]
  return (
    <IconButton label={nextLabel[mode]} variant="surface" onClick={cycleMode}>
      <Icon className="size-4" />
    </IconButton>
  )
}
