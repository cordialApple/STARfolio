import { describe, expect, it } from 'vitest'
import { micErrorMessage } from './mic-error'

const BLOCKED =
  'Microphone access was blocked. Enable it in Windows Settings › Privacy › Microphone, then retry.'

function named(name: string, message = ''): Error {
  const e = new Error(message)
  e.name = name
  return e
}

describe('micErrorMessage', () => {
  it('maps a NotAllowedError to the privacy guidance, ignoring its message', () => {
    expect(micErrorMessage(named('NotAllowedError', 'Permission denied'))).toBe(BLOCKED)
  })

  it('wraps any other Error message in the generic prefix', () => {
    expect(micErrorMessage(named('NotFoundError', 'no device'))).toBe(
      'Could not start listening: no device'
    )
  })

  it('falls back to "unknown error" for an empty or whitespace message', () => {
    expect(micErrorMessage(new Error('   '))).toBe('Could not start listening: unknown error')
  })

  it('stringifies a non-Error throw rather than emitting undefined', () => {
    expect(micErrorMessage('raw string failure')).toBe(
      'Could not start listening: raw string failure'
    )
  })

  it('treats a bare NotAllowedError name on a plain Error as blocked', () => {
    expect(micErrorMessage(named('NotAllowedError'))).toBe(BLOCKED)
  })
})
