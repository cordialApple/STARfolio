export function playScriptedAudio(
  context: AudioContext,
  samples: Float32Array,
  when: number,
  signal: AbortSignal
): Promise<void> {
  if (!samples.length || !samples.every(Number.isFinite))
    return Promise.reject(new Error('Invalid scripted audio'))
  if (signal.aborted) return Promise.reject(new Error('Scripted playback cancelled'))
  const buffer = context.createBuffer(1, samples.length, 24_000)
  buffer.copyToChannel(new Float32Array(samples), 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => {
      finish(new Error('Scripted playback cancelled'))
      try { source.stop() } catch { return }
    }
    signal.addEventListener('abort', abort, { once: true })
    source.onended = () => finish()
    try {
      source.start(when)
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Scripted playback failed'))
    }
    if (signal.aborted) abort()
  })
}
