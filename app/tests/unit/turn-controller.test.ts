import { describe, expect, it } from 'vitest'
import { TurnController } from '../../src/renderer/src/voice/turn-controller'

describe('TurnController', () => {
  it('submits trimmed text and moves to thinking on an auto final while listening', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.onTranscript({ text: 'hello world', isFinal: true })
    expect(submitted).toEqual(['hello world'])
    expect(tc.currentPhase).toBe('thinking')
  })

  it('ignores a non-final auto transcript and stays listening', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.onTranscript({ text: 'still talking', isFinal: false })
    expect(submitted).toEqual([])
    expect(tc.currentPhase).toBe('listening')
  })

  it('ignores a second auto final that arrives while thinking so submit fires once', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.onTranscript({ text: 'first', isFinal: true })
    tc.onTranscript({ text: 'second', isFinal: true })
    expect(submitted).toEqual(['first'])
    expect(tc.currentPhase).toBe('thinking')
  })

  it('ignores an auto final while speaking', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.beginSpeaking()
    tc.onTranscript({ text: 'interrupt', isFinal: true })
    expect(submitted).toEqual([])
    expect(tc.currentPhase).toBe('speaking')
  })

  it('ignores auto finals in ptt mode', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t), 'ptt')
    tc.onTranscript({ text: 'push to talk', isFinal: true })
    expect(submitted).toEqual([])
    expect(tc.currentPhase).toBe('listening')
  })

  it('dispatches submitManual from listening regardless of mode', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t), 'ptt')
    tc.submitManual('manual entry')
    expect(submitted).toEqual(['manual entry'])
    expect(tc.currentPhase).toBe('thinking')
  })

  it('ignores submitManual when phase is thinking or speaking', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.submitManual('first')
    expect(tc.currentPhase).toBe('thinking')
    tc.submitManual('while thinking')
    expect(submitted).toEqual(['first'])
    tc.beginSpeaking()
    tc.submitManual('while speaking')
    expect(submitted).toEqual(['first'])
  })

  it('does not submit empty or whitespace-only text and stays listening', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.onTranscript({ text: '   ', isFinal: true })
    expect(submitted).toEqual([])
    expect(tc.currentPhase).toBe('listening')
    tc.submitManual('')
    expect(submitted).toEqual([])
    expect(tc.currentPhase).toBe('listening')
  })

  it('trims surrounding whitespace off the submitted value', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.onTranscript({ text: '  padded answer  ', isFinal: true })
    expect(submitted).toEqual(['padded answer'])
  })

  it('cycles listening to thinking to speaking to listening then dispatches a fresh final', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.onTranscript({ text: 'turn one', isFinal: true })
    expect(tc.currentPhase).toBe('thinking')
    tc.beginSpeaking()
    expect(tc.currentPhase).toBe('speaking')
    tc.endSpeaking()
    expect(tc.currentPhase).toBe('listening')
    tc.onTranscript({ text: 'turn two', isFinal: true })
    expect(tc.currentPhase).toBe('thinking')
    expect(submitted).toEqual(['turn one', 'turn two'])
  })

  it('reset returns phase to listening from any phase so a new final dispatches', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    tc.beginSpeaking()
    tc.reset()
    expect(tc.currentPhase).toBe('listening')
    tc.onTranscript({ text: 'after reset', isFinal: true })
    expect(submitted).toEqual(['after reset'])
    expect(tc.currentPhase).toBe('thinking')
  })

  it('setMode switches mode so a subsequent auto final is ignored', () => {
    const submitted: string[] = []
    const tc = new TurnController((t) => submitted.push(t))
    expect(tc.currentMode).toBe('auto')
    tc.setMode('ptt')
    expect(tc.currentMode).toBe('ptt')
    tc.onTranscript({ text: 'now ignored', isFinal: true })
    expect(submitted).toEqual([])
    expect(tc.currentPhase).toBe('listening')
  })
})
