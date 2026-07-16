import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractBullets, generateBullets } from '../../src/main/ai/bullets'
import type { InterviewClient } from '../../src/main/ai/interview'
import { initDb } from '../../src/main/db/client'
import { createExperience } from '../../src/main/db/repositories/experiences'

beforeEach(() => initDb(':memory:'))
afterEach(() => vi.unstubAllEnvs())

function capturingClient(bullets: { text: string; experience_id: string }[]): {
  client: InterviewClient
  userText: () => string
} {
  let seen = ''
  const client: InterviewClient = {
    messages: {
      parse: async (params: unknown) => {
        seen = (params as { messages: { content: string }[] }).messages[0].content
        return {
          stop_reason: 'end_turn',
          parsed_output: { bullets },
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      }
    }
  }
  return { client, userText: () => seen }
}

describe('extractBullets experience block', () => {
  it('renders each populated STAR field, skills and metrics into the prompt', async () => {
    const e = createExperience({
      title: 'Rebuilt the deploy pipeline',
      situation: 'Releases were manual and flaky.',
      task: 'Automate and stabilise deploys.',
      action: 'Built a CI pipeline with staged rollouts.',
      result_text: 'Cut release time by half.',
      skills: [
        { name: 'CI/CD', kind: 'technical' },
        { name: 'Leadership', kind: 'soft' }
      ],
      metrics: [{ label: 'Release time', value: 50, unit: '%' }]
    })
    const untitled = createExperience({
      title: '',
      metrics: [{ label: 'Uptime', value: null, unit: null }]
    })
    const { client, userText } = capturingClient([])
    await extractBullets('jd', [e, untitled], client)

    const text = userText()
    expect(text).toContain('Situation: Releases were manual and flaky.')
    expect(text).toContain('Task: Automate and stabilise deploys.')
    expect(text).toContain('Action: Built a CI pipeline with staged rollouts.')
    expect(text).toContain('Result: Cut release time by half.')
    expect(text).toContain('Skills: CI/CD, Leadership')
    expect(text).toContain('Metrics: Release time: 50%')
    expect(text).toContain('Untitled')
    expect(text).toContain('Metrics: Uptime:')
  })

  it('returns nothing when there are no experiences to draw from', async () => {
    const { client } = capturingClient([{ text: 'x', experience_id: 'y' }])
    expect(await extractBullets('jd', [], client)).toEqual([])
  })

  it('keeps grounded bullets and drops ones with unknown ids or blank text', async () => {
    const e = createExperience({ title: 'Shipped the migration', action: 'a' })
    const untitled = createExperience({ title: '', action: 'b' })
    const { client } = capturingClient([
      { text: '  Led the migration  ', experience_id: e.id },
      { text: 'Ghost bullet', experience_id: 'no-such-id' },
      { text: '   ', experience_id: e.id },
      { text: 'Kept it up', experience_id: untitled.id }
    ])

    const bullets = await extractBullets('jd', [e, untitled], client)

    expect(bullets).toEqual([
      { text: 'Led the migration', experienceId: e.id, experienceTitle: 'Shipped the migration' },
      { text: 'Kept it up', experienceId: untitled.id, experienceTitle: 'Untitled' }
    ])
  })

  it('generateBullets loads experiences by id and stubs bullets when AI is stubbed', async () => {
    vi.stubEnv('STARFOLIO_AI_STUB', '1')
    const e = createExperience({ title: 'Owned the rollout', action: 'a' })
    const untitled = createExperience({ title: '', action: 'b' })

    const bullets = await generateBullets('jd', [e.id, untitled.id, 'missing-id'])

    expect(bullets).toEqual([
      { text: 'Delivered Owned the rollout', experienceId: e.id, experienceTitle: 'Owned the rollout' },
      { text: 'Delivered a key result', experienceId: untitled.id, experienceTitle: 'Untitled' }
    ])
  })
})
