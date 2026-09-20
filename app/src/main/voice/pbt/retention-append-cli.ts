import { appendDurableObservationCycle } from './retention-append'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

await appendDurableObservationCycle({
  workspaceRoot: required('PBT_RETENTION_WORKSPACE'),
  remoteUrl: required('PBT_RETENTION_REMOTE'),
  cycleDirectory: required('PBT_VALIDATED_CYCLE_DIR'),
  runId: required('PBT_RUN_ID'),
  runAttempt: required('PBT_RUN_ATTEMPT')
})
