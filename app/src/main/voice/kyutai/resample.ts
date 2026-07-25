export class LinearResampler {
  private readonly step: number
  private frac = 0
  private last = 0
  private primed = false

  constructor(inputRate: number, outputRate: number) {
    this.step = inputRate / outputRate
  }

  reset(): void {
    this.frac = 0
    this.last = 0
    this.primed = false
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0)
    const out: number[] = []
    let start = 0
    if (!this.primed) {
      this.last = input[0]
      this.primed = true
      start = 1
    }
    for (let i = start; i < input.length; i++) {
      const cur = input[i]
      while (this.frac < 1) {
        out.push(this.last * (1 - this.frac) + cur * this.frac)
        this.frac += this.step
      }
      this.frac -= 1
      this.last = cur
    }
    return Float32Array.from(out)
  }
}

export class BlockChunker {
  private buf: number[] = []

  constructor(private readonly size: number) {}

  reset(): void {
    this.buf = []
  }

  push(samples: Float32Array): Float32Array[] {
    for (let i = 0; i < samples.length; i++) this.buf.push(samples[i])
    const blocks: Float32Array[] = []
    while (this.buf.length >= this.size) {
      blocks.push(Float32Array.from(this.buf.splice(0, this.size)))
    }
    return blocks
  }

  flush(): Float32Array | null {
    if (this.buf.length === 0) return null
    const block = new Float32Array(this.size)
    block.set(this.buf)
    this.buf = []
    return block
  }
}
