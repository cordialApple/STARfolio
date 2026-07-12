export function ttsAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// Chromium silently cuts utterances off after ~15s; pause+resume on an interval keeps long
// questions speaking. The handle is module-scoped so stopSpeaking() (and the next speak()) can
// always clear it — even if Chromium wedges and never fires onend/onerror.
let keepAlive: ReturnType<typeof setInterval> | undefined
function clearKeepAlive(): void {
  if (keepAlive) {
    clearInterval(keepAlive)
    keepAlive = undefined
  }
}

// speechSynthesis queues; cancel any in-flight utterance before speaking so a new interviewer
// question replaces the previous one instead of stacking. Default OS voice is fine — getVoices()
// may be empty until 'voiceschanged', but speak() still uses the default voice before then.
export function speak(text: string): void {
  if (!ttsAvailable() || !text.trim()) return
  const synth = window.speechSynthesis
  clearKeepAlive()
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1
  utterance.pitch = 1
  utterance.onstart = () => {
    clearKeepAlive()
    keepAlive = setInterval(() => {
      if (!synth.speaking) return clearKeepAlive()
      synth.pause()
      synth.resume()
    }, 14000)
  }
  utterance.onend = clearKeepAlive
  utterance.onerror = clearKeepAlive
  synth.speak(utterance)
}

export function stopSpeaking(): void {
  clearKeepAlive()
  if (ttsAvailable()) window.speechSynthesis.cancel()
}
