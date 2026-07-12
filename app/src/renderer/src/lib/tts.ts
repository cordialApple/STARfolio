export function ttsAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// speechSynthesis queues; cancel any in-flight utterance before speaking so a new interviewer
// question replaces the previous one instead of stacking. Default OS voice is fine — getVoices()
// may be empty until 'voiceschanged', but speak() still uses the default voice before then.
export function speak(text: string): void {
  if (!ttsAvailable() || !text.trim()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1
  utterance.pitch = 1
  // Chromium silently cuts utterances off after ~15s; pause+resume on an interval keeps long
  // questions speaking to the end.
  let keepAlive: ReturnType<typeof setInterval> | undefined
  const stop = (): void => {
    if (keepAlive) clearInterval(keepAlive)
  }
  utterance.onstart = () => {
    keepAlive = setInterval(() => {
      if (!synth.speaking) return stop()
      synth.pause()
      synth.resume()
    }, 14000)
  }
  utterance.onend = stop
  utterance.onerror = stop
  synth.speak(utterance)
}

export function stopSpeaking(): void {
  if (ttsAvailable()) window.speechSynthesis.cancel()
}
