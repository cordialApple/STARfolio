import { appendRawObservation } from './observation-store'

const [root, encodedEvent] = process.argv.slice(2)
appendRawObservation(root, JSON.parse(encodedEvent))
