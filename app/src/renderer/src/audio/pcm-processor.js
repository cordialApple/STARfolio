class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.active = true
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'stop') return
      this.active = false
      this.port.postMessage({ type: 'drained' })
    }
  }

  process(inputs) {
    if (!this.active) return false
    const channel = inputs[0]?.[0]
    if (channel && channel.length) {
      this.port.postMessage({ type: 'frames', frames: channel.slice(0) })
    }
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
