import { useEffect, useState } from 'react'

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(
    () => window.matchMedia(REDUCE_QUERY).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(REDUCE_QUERY)
    const onChange = (): void => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}
