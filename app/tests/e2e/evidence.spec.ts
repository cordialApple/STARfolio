import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { resolve, join } from 'path'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const PACKAGED_EXE = resolve('./dist/win-unpacked/STARfolio.exe')
const BUILT_MAIN = resolve('./out/main/index.js')
const FOLDER = resolve('./tests/fixtures/evidence/sample-repo')

let app: ElectronApplication

test.beforeAll(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'starfolio-evidence-'))
  const env = { ...process.env, STARFOLIO_AI_STUB: '1', STARFOLIO_EMBED_STUB: '1' }
  const args = [`--user-data-dir=${userDataDir}`]
  app = existsSync(PACKAGED_EXE)
    ? await electron.launch({ executablePath: PACKAGED_EXE, args, env })
    : await electron.launch({ args: [BUILT_MAIN, ...args], env })
})

test.afterAll(async () => {
  await app?.close()
})

test('evidence: a code folder packs into a source-backed draft whose entities connect it to related work', async () => {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // Mirror the import wizard: the real worker packs the folder off-main; evidence + entity
  // extraction (stubbed) then feed the draft and the knowledge graph.
  const packed = await win.evaluate(async (folder) => {
    const r = await window.api.ingest.codeFolder(folder)
    const src = r.source!
    const ext = await window.api.evidence.extract(src.raw_text!, 'code')
    const ents = await window.api.entity.extract(src.raw_text!)
    const a = await window.api.bank.create({
      title: 'Ledger service',
      situation: ext.situation.text,
      task: ext.task.text,
      action: ext.action.text,
      result_text: ext.result.text,
      context: 'project',
      status: 'draft',
      skills: [],
      tags: [],
      metrics: [],
      source_id: src.id
    })
    await window.api.graph.link(a.id, ents.entities)

    const shared = ents.entities[0]
    const b = await window.api.bank.create({
      title: 'Related work',
      situation: '',
      task: '',
      action: 'did related things',
      result_text: '',
      context: 'work',
      status: 'confirmed',
      skills: [],
      tags: [],
      metrics: []
    })
    await window.api.graph.link(b.id, [shared])
    return { sourceKind: src.kind, hasEntities: ents.entities.length > 0, packHasTree: (src.raw_text ?? '').includes('File tree:') }
  }, FOLDER)

  expect(packed.sourceKind).toBe('code')
  expect(packed.hasEntities).toBe(true)
  expect(packed.packHasTree).toBe(true)

  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByText('Related work').first().click()

  await expect(win.getByText('Connected to')).toBeVisible()
  await expect(win.getByRole('button', { name: /Ledger service/ })).toBeVisible()
})
