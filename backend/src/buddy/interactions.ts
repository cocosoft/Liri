import type { Companion, StatName } from './types'

export type InteractionAction = 'pet' | 'feed' | 'play' | 'talk' | 'compliment'

export interface InteractionResult {
  action: InteractionAction
  companionId: string
  timestamp: number
  response: string
  statChanges: Partial<Record<StatName, number>>
  affectionChange: number
}

export interface InteractionEntry {
  action: InteractionAction
  timestamp: number
  response: string
  statChanges: Partial<Record<StatName, number>>
  affectionChange: number
}

export interface InteractionHistory {
  companionId: string
  entries: InteractionEntry[]
}

const RESPONSES: Record<InteractionAction, string[]> = {
  pet: [
    'purrs happily',
    'leans into your hand',
    'closes its eyes in contentment',
    'makes a soft appreciative sound',
  ],
  feed: [
    'munches enthusiastically',
    'nibbles carefully from your hand',
    'looks up at you with gratitude',
    'savors every bite',
  ],
  play: [
    'bounces around excitedly',
    'chases after the toy with glee',
    'pounces with dramatic flair',
    'tumbles over itself mid-play',
  ],
  talk: [
    'listens attentively and tilts its head',
    'responds with an encouraging chirp',
    'nuzzles closer as you speak',
    'gazes at you with understanding eyes',
  ],
  compliment: [
    'puffs up with visible pride',
    'does a little happy dance',
    'glows warmly at your words',
    'preens modestly while blushing',
  ],
}

const STAT_EFFECTS: Record<InteractionAction, Partial<Record<StatName, number>>> = {
  pet: { WISDOM: 1, SNARK: -1 },
  feed: { PATIENCE: 2 },
  play: { CHAOS: 2, DEBUGGING: -1 },
  talk: { WISDOM: 2, PATIENCE: 1 },
  compliment: { SNARK: -1, WISDOM: 1 },
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export class InteractionManager {
  private histories = new Map<string, InteractionEntry[]>()
  private readonly maxHistoryPerCompanion = 100

  async execute(companion: Companion, action: InteractionAction): Promise<InteractionResult> {
    const timestamp = Date.now()
    const response = pickRandom(RESPONSES[action])
    const statChanges = { ...STAT_EFFECTS[action] }
    const affectionChange = action === 'compliment' ? 3 : action === 'pet' ? 2 : 1

    const entry: InteractionEntry = {
      action,
      timestamp,
      response,
      statChanges,
      affectionChange,
    }

    const id = companion.name
    let history = this.histories.get(id)
    if (!history) {
      history = []
      this.histories.set(id, history)
    }
    history.push(entry)
    if (history.length > this.maxHistoryPerCompanion) {
      history.splice(0, history.length - this.maxHistoryPerCompanion)
    }

    return { action, companionId: id, timestamp, response, statChanges, affectionChange }
  }

  getAvailableInteractions(_companion: Companion): InteractionAction[] {
    return Object.keys(RESPONSES) as InteractionAction[]
  }

  trackInteractionHistory(companionId: string): InteractionHistory {
    return {
      companionId,
      entries: [...(this.histories.get(companionId) ?? [])],
    }
  }

  getInteractionCount(companionId: string): number {
    return this.histories.get(companionId)?.length ?? 0
  }
}
