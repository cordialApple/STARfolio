import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = join(process.cwd(), '..')
const workflowRoot = join(repositoryRoot, '.github', 'workflows')

function readWorkflow(name: string): string {
  return readFileSync(join(workflowRoot, name), 'utf8')
}

function readJob(workflow: string, name: string, nextName?: string): string {
  const start = workflow.indexOf(`\n  ${name}:`)
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start + 1) : workflow.length
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return workflow.slice(start, end)
}

function expectEncryptedArtifact(workflow: string, name: string): void {
  expect(workflow).toContain(`name: ${name}`)
  expect(workflow).toContain('manifest.json')
  expect(workflow).toContain('payload.enc')
  expect(workflow).toContain('if-no-files-found: error')
  expect(workflow).toContain('include-hidden-files: true')
  expect(workflow).toContain('retention-days: 90')
}

function expectRunnerContextOnlyInSteps(workflow: string): void {
  expect(workflow).not.toMatch(/^ {6}\S.*\$\{\{ runner\.temp \}\}/m)
}

function expectCleanRetentionPipeline(workflow: string, needsCapture = false): void {
  const validate = readJob(workflow, 'validate', 'retain')
  const retain = readJob(workflow, 'retain')

  if (needsCapture) {
    expect(validate).toContain('needs: capture')
    expect(validate).toContain("if: always() && needs.capture.result != 'skipped'")
  }
  expect(validate).toContain('PBT_RETENTION_MODE: validate')
  expect(validate).toContain(
    'PBT_OBSERVATION_PRIVATE_KEYS: ${{ secrets.PBT_OBSERVATION_PRIVATE_KEYS }}'
  )
  expect(validate).toContain('npm run pbt:stage')
  expect(validate).toContain('persist-credentials: false')
  expect(validate).not.toContain('path: candidate')
  expect(retain).toContain('needs: validate')
  expect(retain).toContain('group: pbt-observation-retention')
  expect(retain).toContain('cancel-in-progress: false')
  expect(retain).toContain('npm run pbt:retain')
  expect(retain).toContain('GIT_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  expect(retain).not.toContain('PBT_OBSERVATION_PRIVATE_KEYS')
  expect(workflow).not.toContain('x-access-token:${{ secrets.GITHUB_TOKEN }}@')
  expect(workflow).not.toMatch(/git push\s+["']?https:/)
}

describe('PBT CI retention workflows', () => {
  it('uploads encrypted main CI cycles and exposes no private key', () => {
    const workflow = readWorkflow('ci.yml')

    expectRunnerContextOnlyInSteps(workflow)
    expect(workflow).toContain("branches: [main, 'stage/**']")
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).toContain(
      'PBT_SPOOL_DIR: ${{ runner.temp }}/starfolio-pbt/${{ github.run_id }}-${{ github.run_attempt }}'
    )
    expect(workflow).toMatch(
      /name: Stage safe PBT observations\s+if: always\(\) && github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/
    )
    expectEncryptedArtifact(
      workflow,
      'pbt-observations-${{ github.run_id }}-${{ github.run_attempt }}'
    )
    expect(workflow).toContain('PBT_REPOSITORY_SHA: ${{ github.sha }}')
    expect(workflow).toContain('PBT_REPOSITORY_BRANCH: ${{ github.head_ref || github.ref_name }}')
    expect(workflow).toContain('PBT_RETENTION_MODE: encrypt')
    expect(workflow).toContain('.github/pbt-observation-public.pem')
    expect(workflow).not.toContain('PBT_OBSERVATION_PRIVATE_KEYS')
    expect(workflow).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'")
    expect(workflow).toContain("--exclude '**/*.pbt.test.ts' --exclude '**/pbt.self.test.ts'")
  })

  it('captures and retains same-repository PR cycles inside the PR workflow', () => {
    const workflow = readWorkflow('pbt-pr-capture.yml')
    const capture = readJob(workflow, 'capture', 'validate')
    const validate = readJob(workflow, 'validate', 'retain')

    expectRunnerContextOnlyInSteps(workflow)
    expect(workflow).toContain('pull_request_target:')
    expect(capture).toContain('github.event.pull_request.head.repo.full_name == github.repository')
    expect(capture).toContain('ref: ${{ github.event.pull_request.head.sha }}')
    expect(capture).toContain('PBT_REPOSITORY_SHA: ${{ github.event.pull_request.head.sha }}')
    expect(capture).toContain('PBT_REPOSITORY_BRANCH: ${{ github.event.pull_request.head.ref }}')
    expect(capture).toContain('path: candidate')
    expect(capture).toContain('path: trusted')
    expect(capture).toContain('ref: main')
    expect(capture).toContain('candidate:/candidate:ro')
    expect(capture).toContain('docker run --rm')
    expect(capture).toContain('npm run pbt:stage')
    expect(capture).toContain('PBT_RETENTION_MODE: encrypt')
    expectEncryptedArtifact(
      capture,
      'pbt-pr-observations-${{ github.run_id }}-${{ github.run_attempt }}'
    )
    expect(capture).not.toContain('PBT_OBSERVATION_PRIVATE_KEYS')
    expect(validate).toContain('PBT_REPOSITORY_SHA: ${{ github.event.pull_request.head.sha }}')
    expect(validate).toContain('PBT_REPOSITORY_BRANCH: ${{ github.event.pull_request.head.ref }}')
    expect(workflow).not.toContain('workflow_run.pull_requests')
    expectCleanRetentionPipeline(workflow, true)
  })

  it('retains only trusted main CI push cycles from workflow_run', () => {
    const workflow = readWorkflow('pbt-retention.yml')

    expectRunnerContextOnlyInSteps(workflow)
    expect(workflow).toContain('workflows: [CI]')
    expect(workflow).toContain("github.event.workflow_run.event == 'push'")
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'")
    expect(workflow).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository'
    )
    expect(workflow).toContain('PBT_REPOSITORY_SHA: ${{ github.event.workflow_run.head_sha }}')
    expect(workflow).toContain(
      'PBT_REPOSITORY_BRANCH: ${{ github.event.workflow_run.head_branch }}'
    )
    expect(workflow).not.toContain('PBT PR capture')
    expect(workflow).not.toContain('pull_request_target')
    expect(workflow).not.toContain('workflow_run.pull_requests')
    expectCleanRetentionPipeline(workflow)
  })

  it('captures stage branch PBT in isolation and retains it with trusted code', () => {
    const workflow = readWorkflow('pbt-stage-capture.yml')
    const capture = readJob(workflow, 'capture', 'validate')
    const validate = readJob(workflow, 'validate', 'retain')

    expectRunnerContextOnlyInSteps(workflow)
    expect(workflow).toContain('workflow_run:')
    expect(workflow).toContain('workflows: [CI]')
    expect(capture).toContain("github.event.workflow_run.event == 'push'")
    expect(capture).toContain("startsWith(github.event.workflow_run.head_branch, 'stage/')")
    expect(capture).toContain('ref: ${{ github.event.workflow_run.head_sha }}')
    expect(capture).toContain('PBT_REPOSITORY_SHA: ${{ github.event.workflow_run.head_sha }}')
    expect(capture).toContain('PBT_REPOSITORY_BRANCH: ${{ github.event.workflow_run.head_branch }}')
    expect(capture).toContain('path: candidate')
    expect(capture).toContain('path: trusted')
    expect(capture).toContain('ref: main')
    expect(capture).toContain('candidate:/candidate:ro')
    expect(capture).toContain('docker run --rm')
    expect(capture).toContain('npm run pbt:stage')
    expect(capture).toContain('PBT_RETENTION_MODE: encrypt')
    expectEncryptedArtifact(
      capture,
      'pbt-stage-observations-${{ github.run_id }}-${{ github.run_attempt }}'
    )
    expect(capture).not.toContain('PBT_OBSERVATION_PRIVATE_KEYS')
    expect(validate).toContain('PBT_REPOSITORY_SHA: ${{ github.event.workflow_run.head_sha }}')
    expect(validate).toContain(
      'PBT_REPOSITORY_BRANCH: ${{ github.event.workflow_run.head_branch }}'
    )
    expect(workflow).not.toContain('workflow_run.pull_requests')
    expectCleanRetentionPipeline(workflow, true)
  })
})
