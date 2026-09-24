import { NativeInterviewAudit } from './NativeInterviewAudit'
import { useState } from 'react'
import { Button, Card, Input, Textarea } from '../components'
import { useMoshiInterviewSession } from './useMoshiInterviewSession'

interface NativeInterviewProps {
  resumeText: string
  candidateName: string
  onBack: () => void
  onHistory: () => void
}

export function MoshiDemoView({
  resumeText,
  candidateName,
  onBack,
  onHistory
}: NativeInterviewProps): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>([])
  const [endpoint, setEndpoint] = useState('ws://127.0.0.1:8765/session')
  const [jobDescription, setJobDescription] = useState('')
  const [consent, setConsent] = useState(false)
  const [recordTrialMedia, setRecordTrialMedia] = useState(false)
  const [duration, setDuration] = useState(1200)
  const {
    bank,
    status,
    checking,
    connection,
    mode,
    active,
    ending,
    snapshot,
    level,
    start,
    checkConnection,
    requestEnd
  } = useMoshiInterviewSession({
    resumeText,
    candidateName,
    endpoint,
    experienceIds: selected,
    durationSeconds: duration,
    jobDescription,
    consent,
    recordTrialMedia
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Native duplex interview</h1>
          <p className="mt-2 text-sm text-muted">
            Your interview roadmap and evaluator steer Moshi while it listens and speaks. Use
            headphones.
          </p>
        </div>
        <Button onClick={onBack} disabled={active}>
          Back to interview setup
        </Button>
      </div>
      <details className="text-sm">
        <summary>Resume for this interview</summary>
        <p className="mt-2 whitespace-pre-wrap">{resumeText}</p>
      </details>
      <Card className="space-y-4 p-5">
        <label className="block text-sm font-bold">
          Job description (optional)
          <Textarea
            aria-label="Job description"
            rows={3}
            value={jobDescription}
            disabled={active}
            onChange={(event) => setJobDescription(event.target.value)}
          />
        </label>
        <label className="block text-sm font-bold">
          Local tunnel endpoint
          <Input
            aria-label="Local tunnel endpoint"
            value={endpoint}
            disabled={active}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </label>
        <Button onClick={() => void checkConnection()} disabled={checking || active}>
          Test connection
        </Button>
        <p role="status" className="text-sm">
          {connection}
        </p>
        <label className="block text-sm font-bold">
          Session limit
          <select
            className="ml-3 rounded border border-line bg-canvas p-2"
            value={duration}
            disabled={active}
            onChange={(event) => setDuration(Number(event.target.value))}
          >
            <option value={300}>5 minutes</option>
            <option value={1200}>20 minutes</option>
            <option value={1800}>30 minutes</option>
          </select>
        </label>
        <fieldset disabled={active} className="space-y-2">
          <legend className="mb-2 font-bold">Evidence for roadmap ({selected.length}/12)</legend>
          {!bank.length && (
            <p className="text-sm text-muted">
              Bank empty. Add an experience in Bank, then return here.
            </p>
          )}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {bank.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-3 rounded border border-line p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(item.id)}
                  disabled={!selected.includes(item.id) && selected.length >= 12}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)
                    )
                  }
                />
                <span>
                  <span className="font-bold">{item.title}</span>
                  <span className="block text-sm text-muted">{item.snippet}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={consent}
            disabled={active}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Send microphone audio, selected evidence, and derived roadmap / steering to the
            configured remote MoshiRAG worker. Current deployment runs in my AWS account. Send
            resume, job description, and transcript to my configured architect and evaluator
            providers. Save transcript, scores, and report locally.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={recordTrialMedia}
            disabled={active}
            onChange={(event) => setRecordTrialMedia(event.target.checked)}
          />
          <span>
            Save raw interview audio on this computer for trial review. Input and output stay in
            separate local files; neither is uploaded automatically. Off by default.
          </span>
        </label>
        <div className="flex gap-3">
          <Button
            onClick={() => void start()}
            disabled={active || checking || !consent || !selected.length}
          >
            Start native interview
          </Button>
          <Button onClick={requestEnd} disabled={!active || ending}>
            End interview
          </Button>
        </div>
        <p role="status" className="text-sm">
          {status}
        </p>
        {active && mode === 'moshi' && (
          <meter
            aria-label="Microphone level"
            min={0}
            max={1}
            value={Math.min(1, level * 5)}
            className="w-full"
          />
        )}
        <p className="text-xs text-muted">Remote worker termination must be verified after End.</p>
      </Card>
      {snapshot && (
        <>
          <NativeInterviewAudit key={snapshot.id} snapshot={snapshot} />
          {snapshot.report && (
            <Card className="space-y-3 p-5">
              <h2 className="font-bold">Interview report</h2>
              <p>{snapshot.report.overallFeedback}</p>
              <h3 className="font-semibold">Strengths</h3>
              <ul className="list-disc pl-5">
                {snapshot.report.strengths.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
              <h3 className="font-semibold">Next practice</h3>
              <ul className="list-disc pl-5">
                {snapshot.report.improvementAreas.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
              <Button onClick={onHistory} disabled={active}>
                Open interview history
              </Button>
            </Card>
          )}
          <Card className="space-y-3 p-5">
            <h2 className="font-bold">Canonical transcript</h2>
            <div aria-live="polite" className="max-h-96 space-y-3 overflow-y-auto">
              {snapshot.transcript.map((line, i) => (
                <p key={i} className="whitespace-pre-wrap text-sm">
                  <strong>{line.speaker === 'interviewer' ? 'Interviewer' : 'Candidate'}: </strong>
                  {line.text}
                  {line.truncated ? ' [cut off]' : ''}
                  <span className="ml-2 text-xs text-muted">
                    {(line.startMs / 1000).toFixed(1)}–{(line.endMs / 1000).toFixed(1)}s
                  </span>
                </p>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
