import { describe, expect, it } from 'vitest'
import { HalfDuplexGate, defaultHalfDuplexConfig } from '../../src/main/voice/streaming'

describe('HalfDuplexGate', () => {
  it('opens capture on a fresh default gate for any now', () => {
    const gate = new HalfDuplexGate()
    expect(gate.captureOpen(0)).toBe(true)
    expect(gate.captureOpen(999999)).toBe(true)
  })

  it('closes capture while speaking regardless of now', () => {
    const gate = new HalfDuplexGate()
    gate.onTtsStart()
    expect(gate.captureOpen(0)).toBe(false)
    expect(gate.captureOpen(999999)).toBe(false)
  })

  it('holds capture shut through the guard tail then reopens', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 250 }))
    gate.onTtsStart()
    gate.onTtsEnd(1000)
    expect(gate.captureOpen(1249)).toBe(false)
    expect(gate.captureOpen(1250)).toBe(true)
    expect(gate.captureOpen(2000)).toBe(true)
  })

  it('respects a custom guardMs', () => {
    const gate = new HalfDuplexGate(defaultHalfDuplexConfig({ guardMs: 500 }))
    gate.onTtsStart()
    gate.onTtsEnd(1000)
    expect(gate.captureOpen(1499)).toBe(false)
    expect(gate.captureOpen(1500)).toBe(true)
  })

  it('reset clears speaking and releaseAt after a start/end cycle', () => {
    const gate = new HalfDuplexGate()
    gate.onTtsStart()
    gate.onTtsEnd(1000)
    expect(gate.captureOpen(0)).toBe(false)
    gate.reset()
    expect(gate.captureOpen(0)).toBe(true)
  })

  it('defaultHalfDuplexConfig returns guardMs 250 and merges overrides', () => {
    expect(defaultHalfDuplexConfig()).toEqual({ guardMs: 250 })
    expect(defaultHalfDuplexConfig({ guardMs: 500 })).toEqual({ guardMs: 500 })
  })
})
