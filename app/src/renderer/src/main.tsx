import React, { type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/nunito'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import { ThemeProvider } from './theme/ThemeProvider'
import { ToastProvider } from './components'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

function mount(node: ReactNode): void {
  root.render(
    <React.StrictMode>
      <ThemeProvider>
        <ToastProvider>{node}</ToastProvider>
      </ThemeProvider>
    </React.StrictMode>
  )
}

if (import.meta.env.DEV && window.location.hash === '#preview') {
  import('./preview/Preview').then(({ Preview }) => mount(<Preview />))
} else {
  mount(<App />)
}
