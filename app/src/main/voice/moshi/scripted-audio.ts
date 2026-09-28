import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { scriptedLine } from '../../ai/roles/scripted-turns'

const execFileAsync = promisify(execFile)
export type ScriptedKind = 'ask_intro' | 'closing' | 'done'
export type ScriptedAudio = Record<ScriptedKind, Float32Array>
const KINDS: ScriptedKind[] = ['ask_intro', 'closing', 'done']
let cached: Promise<ScriptedAudio> | undefined

export function pcm16ToFloat32(bytes: Buffer): Float32Array {
  if (!bytes.length || bytes.length % 2 || bytes.length > 2_000_000)
    throw new Error('Invalid scripted PCM')
  const samples = new Float32Array(bytes.length / 2)
  for (let index = 0; index < samples.length; index++)
    samples[index] = bytes.readInt16LE(index * 2) / 32768
  return samples
}

async function synthesize(text: string): Promise<Float32Array> {
  const escaped = text.replaceAll("'", "''")
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$stream = [System.IO.MemoryStream]::new()',
    '$format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    '$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()',
    'try {',
    '  $synth.SetOutputToAudioStream($stream, $format)',
    `  $synth.Speak('${escaped}')`,
    '  [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))',
    '} finally { $synth.Dispose(); $stream.Dispose() }'
  ].join('; ')
  const command = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', command],
    { windowsHide: true, timeout: 15_000, maxBuffer: 3_000_000 }
  )
  const encoded = stdout.trim()
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error('Invalid scripted PCM')
  return pcm16ToFloat32(Buffer.from(encoded, 'base64'))
}

export function loadScriptedAudio(): Promise<ScriptedAudio> {
  if (process.platform !== 'win32')
    return Promise.reject(new Error('Scripted audio requires Windows system speech'))
  if (!cached) {
    cached = Promise.all(KINDS.map((kind) => synthesize(scriptedLine(kind)!)))
      .then(([ask_intro, closing, done]) => ({ ask_intro, closing, done }))
      .catch((error: unknown) => {
        cached = undefined
        throw new Error('Scripted audio unavailable', { cause: error })
      })
  }
  return cached
}
