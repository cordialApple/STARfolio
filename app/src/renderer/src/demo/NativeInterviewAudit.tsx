import { useEffect, useState } from 'react'
import { Button, Card } from '../components'
import type { MoshiInterviewSnapshot, MoshiRigorResult } from '../../../preload/index.d'

function describeScoringMode(mode: MoshiInterviewSnapshot['mode']): string {
  if (mode === 'stub') return 'Fixture scoring only — no live model validation'
  if (mode === 'mixed') return 'Mixed fixture and live models — not valid for the GPU rigor gate'
  return 'Live provider scoring — GPU rigor gate remains unverified'
}

export function NativeInterviewAudit({
  snapshot
}: {
  snapshot: MoshiInterviewSnapshot
}): React.JSX.Element {
  const [rigor, setRigor] = useState<MoshiRigorResult | null>(null)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const last = snapshot.conditioning.at(-1)
  async function compare(): Promise<void> {
    setComparing(true)
    setError(null)
    try {
      setRigor(await window.api.moshiDemo.rigor(snapshot.id))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Comparison failed')
    } finally {
      setComparing(false)
    }
  }
  function download(): void {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ interview: snapshot, rigor }, null, 2)], {
        type: 'application/json'
      })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `interview-audit-${snapshot.id}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Roadmap and scoring</h2>
        <Button onClick={download}>Save interview audit</Button>
      </div>
      <p className="text-sm">{describeScoringMode(snapshot.mode)}</p>
      <p className="text-sm">
        {snapshot.evaluations.length} scored segment groups · {snapshot.status}
      </p>
      <div className="space-y-3">
        {snapshot.state.roadmap.topics.map((topic) => (
          <div key={topic.id}>
            <h3 className="font-semibold">{topic.label}</h3>
            <p className="text-sm text-muted">
              {Object.entries(topic.coverage)
                .map(([dimension, score]) => `${dimension}: ${score}`)
                .join(' · ')}
            </p>
          </div>
        ))}
      </div>
      {last && (
        <p className="text-sm">
          Next intent: {last.action.intent.kind} · revision {last.revision} · {last.delivery}
        </p>
      )}
      <p className="text-xs text-muted">
        Conditioning delivery does not confirm Moshi followed the intent. Scores retain actual
        answer evidence. Topic changes require verified observed questions; unresolved answers
        remain outside coverage. Live rigor still needs review.
      </p>
      {snapshot.transcriptIntegrity === 'incomplete' && (
        <p role="alert" className="text-sm">
          Transcript incomplete: {snapshot.terminationReason}. This session cannot pass the live
          rigor gate.
        </p>
      )}
      {snapshot.realizations?.map((item, i) => (
        <details key={`question-${i}`} className="text-sm">
          <summary>
            Question check {i + 1}: {item.binding}
          </summary>
          <p>{item.reason}</p>
          <blockquote>{item.evidence}</blockquote>
        </details>
      ))}
      {snapshot.unattributed?.map((item, i) => (
        <details key={`unattributed-${i}`} className="text-sm">
          <summary>Unscored answer {i + 1}</summary>
          <p>{item.reason}</p>
          <p>{item.segments.map((entry) => entry.text).join(' ')}</p>
        </details>
      ))}
      {snapshot.evaluations.map((evaluation, i) => (
        <details key={i} className="text-sm">
          <summary>
            Score evidence {i + 1}: {evaluation.input.topicLabel}
            {evaluation.overlap ? ' · overlapping speech' : ''}
            {evaluation.truncated ? ' · truncated' : ''}
          </summary>
          <p className="mt-2">
            Question: {evaluation.input.question || '(no attributed question)'}
          </p>
          <p className="whitespace-pre-wrap">Answer: {evaluation.input.answer}</p>
          <p>
            {Object.entries(evaluation.evaluation.coverageDeltas)
              .map(([dimension, score]) => `${dimension}: ${score}`)
              .join(' · ') || 'No coverage demonstrated'}
          </p>
        </details>
      ))}
      {snapshot.status === 'finished' && snapshot.evaluations.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          <Button onClick={() => void compare()} disabled={comparing}>
            {comparing ? 'Comparing scores…' : 'Compare scoring'}
          </Button>
          <p className="text-xs text-muted">
            Replays identical answers as full turns and recorded gap groups.{' '}
            {snapshot.mode === 'stub'
              ? 'Uses fixtures; no API charges.'
              : 'Uses current evaluator provider and incurs additional API charges; at most 64 calls.'}{' '}
            Human review still checks question alignment and score evidence.
          </p>
        </div>
      )}
      {rigor && (
        <div role="status" className="text-sm">
          <p>
            Scoring comparison: {rigor.verdict} · {(rigor.agreement * 100).toFixed(1)}% dimension
            agreement
          </p>
          {rigor.rows.map((row, i) => (
            <p key={i}>
              {row.context.topicLabel}:{' '}
              {Object.entries(row.dimensions)
                .map(([dimension, values]) => `${dimension} ${values.cascade}/${values.gap}`)
                .join(' · ')}
            </p>
          ))}
        </div>
      )}
      {(error || snapshot.error) && <p role="alert">{error ?? snapshot.error}</p>}
    </Card>
  )
}

export function SavedNativeInterviewAudit({ id }: { id: string }): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<MoshiInterviewSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.moshiDemo
      .audit(id)
      .then((value) => {
        if (!cancelled) setSnapshot(value)
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [id])
  if (error) return <p role="alert">{error}</p>
  return snapshot ? <NativeInterviewAudit key={snapshot.id} snapshot={snapshot} /> : null
}
