import { describe, expect, it, vi } from 'vitest'
import { TurnController } from './turn-controller'

describe('TurnController', () => {
  it('auto: dispatches once on a final transcript', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'auto')
    c.onTranscript({ text: 'my answer', isFinal: true })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('my answer')
    expect(c.currentPhase).toBe('thinking')
  })

  it('auto: ignores non-final transcripts', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'auto')
    c.onTranscript({ text: 'partial', isFinal: false })
    expect(submit).not.toHaveBeenCalled()
    expect(c.currentPhase).toBe('listening')
  })

  it('auto: does not re-dispatch while thinking', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'auto')
    c.onTranscript({ text: 'first', isFinal: true })
    c.onTranscript({ text: 'second', isFinal: true })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('first')
  })

  it('auto: resumes after reset', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'auto')
    c.onTranscript({ text: 'first', isFinal: true })
    c.reset()
    expect(c.currentPhase).toBe('listening')
    c.onTranscript({ text: 'second', isFinal: true })
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenLastCalledWith('second')
  })

  it('ptt: never auto-dispatches on transcripts', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'ptt')
    c.onTranscript({ text: 'final answer', isFinal: true })
    expect(submit).not.toHaveBeenCalled()
    expect(c.currentPhase).toBe('listening')
  })

  it('trims whitespace and drops empty dispatches', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'auto')
    c.onTranscript({ text: '   ', isFinal: true })
    expect(submit).not.toHaveBeenCalled()
    expect(c.currentPhase).toBe('listening')
    c.onTranscript({ text: '  spaced  ', isFinal: true })
    expect(submit).toHaveBeenCalledWith('spaced')
  })

  it('does not dispatch transcripts while speaking (half-duplex)', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'auto')
    c.beginSpeaking()
    c.onTranscript({ text: 'echo of tts', isFinal: true })
    expect(submit).not.toHaveBeenCalled()
    c.endSpeaking()
    expect(c.currentPhase).toBe('listening')
    c.onTranscript({ text: 'real answer', isFinal: true })
    expect(submit).toHaveBeenCalledWith('real answer')
  })

  it('submitManual dispatches only while listening', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'ptt')
    c.submitManual('typed')
    expect(submit).toHaveBeenCalledWith('typed')
    c.submitManual('again')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('setMode switches dispatch behavior', () => {
    const submit = vi.fn()
    const c = new TurnController(submit, 'ptt')
    c.onTranscript({ text: 'x', isFinal: true })
    expect(submit).not.toHaveBeenCalled()
    c.setMode('auto')
    c.onTranscript({ text: 'y', isFinal: true })
    expect(submit).toHaveBeenCalledWith('y')
  })
})
