import type { InterviewAction } from '../roadmap'

export function scriptedLine(kind: InterviewAction['kind']): string | null {
  switch (kind) {
    case 'ask_intro':
      return 'Hello, thanks for joining me. Tell me about yourself.'
    case 'closing':
      return 'That covers my questions. What questions do you have for me?'
    case 'done':
      return 'Thank you for your time. That concludes the interview.'
    default:
      return null
  }
}
