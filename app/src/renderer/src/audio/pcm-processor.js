// AudioWorkletProcessor: forwards mono Float32 frames from the render thread.
// Kept as plain .js (not .ts) and loaded via `new URL(..., import.meta.url)` so Vite
// emits it as a real asset that resolves in both dev and the packaged app.
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel && channel.length) {
      this.port.postMessage(channel.slice(0))
    }
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
