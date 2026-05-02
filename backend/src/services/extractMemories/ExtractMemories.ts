export type MemoryType = 'user_fact' | 'user_preference' | 'project_knowledge' | 'code_pattern' | 'decision'

export type ExtractedMemory = {
  type: MemoryType
  title: string
  content: string
  confidence: number
  source: string
  timestamp: number
}

export type MemoryExtractionResult = {
  memories: ExtractedMemory[]
  stats: {
    newCount: number
    updatedCount: number
    skippedCount: number
  }
}

export type ExtractionConfig = {
  minConfidence: number
  maxMemoriesPerExtraction: number
  types: MemoryType[]
  enabled: boolean
}

const DEFAULT_CONFIG: ExtractionConfig = {
  minConfidence: 0.5,
  maxMemoriesPerExtraction: 5,
  types: ['user_fact', 'user_preference', 'project_knowledge', 'code_pattern', 'decision'],
  enabled: true,
}

const MEMORY_SIGNAL_PATTERNS: Array<{
  pattern: RegExp
  type: MemoryType
  weight: number
}> = [
  { pattern: /(?:I (?:am|like|prefer|want|need|use|work|develop|maintain|hate|love|dislike))/i, type: 'user_preference', weight: 0.8 },
  { pattern: /(?:the (?:project|codebase|app|system|repo) (?:is|uses|has|requires|needs|follows|runs))/i, type: 'project_knowledge', weight: 0.7 },
  { pattern: /(?:pattern|convention|best practice|architecture|design pattern)/i, type: 'code_pattern', weight: 0.7 },
  { pattern: /(?:decided|chose|went with|will use|should use|going to use)/i, type: 'decision', weight: 0.7 },
  { pattern: /(?:my (?:name|role|job|team|company|background) is|I work (?:as|at|for|on))/i, type: 'user_fact', weight: 0.8 },
  { pattern: /remember (?:to|that|this)|note (?:to|that|this)|don't forget/i, type: 'project_knowledge', weight: 0.9 },
  { pattern: /(?:the (?:configuration|settings|environment|setup) (?:is|needs|requires))/i, type: 'project_knowledge', weight: 0.6 },
  { pattern: /(?:always|never|usually|typically|generally) (?:use|run|do|need|call|import|require)/i, type: 'code_pattern', weight: 0.6 },
]

function extractSignalMemories(
  message: string,
  source: string,
  config: ExtractionConfig,
): ExtractedMemory[] {
  const memories: ExtractedMemory[] = []

  for (const { pattern, type, weight } of MEMORY_SIGNAL_PATTERNS) {
    if (!config.types.includes(type)) continue
    if (memories.length >= config.maxMemoriesPerExtraction) break

    const match = pattern.exec(message)
    if (match) {
      const contextStart = Math.max(0, match.index - 30)
      const contextEnd = Math.min(message.length, match.index + match[0].length + 100)
      const snippet = message.slice(contextStart, contextEnd).trim()

      const titlePattern = /(?:I (?:am|like|prefer|want|use|work) )?(.*?)(?:\.|$|,| and)/i
      const titleMatch = snippet.match(titlePattern)
      const title = titleMatch
        ? titleMatch[0].replace(/^[,\s]+/, '').slice(0, 80)
        : snippet.slice(0, 80)

      memories.push({
        type,
        title,
        content: snippet,
        confidence: weight,
        source,
        timestamp: Date.now(),
      })
    }
  }

  return memories
}

function deduplicateMemories(
  existing: ExtractedMemory[],
  newMemories: ExtractedMemory[],
): { toAdd: ExtractedMemory[]; toUpdate: Array<{ old: ExtractedMemory; new: ExtractedMemory }> } {
  const toAdd: ExtractedMemory[] = []
  const toUpdate: Array<{ old: ExtractedMemory; new: ExtractedMemory }> = []

  for (const newMem of newMemories) {
    let found = false
    for (const existingMem of existing) {
      if (existingMem.type === newMem.type && existingMem.title === newMem.title) {
        if (newMem.confidence > existingMem.confidence) {
          toUpdate.push({ old: existingMem, new: newMem })
        }
        found = true
        break
      }
    }
    if (!found) {
      toAdd.push(newMem)
    }
  }

  return { toAdd, toUpdate }
}

export class ExtractMemories {
  private config: ExtractionConfig
  private memoryStore: Map<string, ExtractedMemory[]> = new Map()

  constructor(config?: Partial<ExtractionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  async extract(
    messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; content?: any }> }>,
    sessionId: string,
  ): Promise<MemoryExtractionResult> {
    if (!this.config.enabled) {
      return { memories: [], stats: { newCount: 0, updatedCount: 0, skippedCount: 0 } }
    }

    const textMessages = messages
      .map(m => {
        if (typeof m.content === 'string') return m.content
        if (Array.isArray(m.content)) {
          return m.content
            .filter(b => b.type === 'text' || b.type === 'tool_result')
            .map(b => b.text || '')
            .join('\n')
        }
        return ''
      })
      .filter(Boolean)

    const combinedText = textMessages.join('\n\n')
    const source = `session:${sessionId}`

    let signalMemories = extractSignalMemories(combinedText, source, this.config)

    signalMemories = signalMemories.filter(
      m => m.confidence >= this.config.minConfidence,
    )

    signalMemories = signalMemories.slice(0, this.config.maxMemoriesPerExtraction)

    const existing = this.memoryStore.get(sessionId) || []
    const { toAdd, toUpdate } = deduplicateMemories(existing, signalMemories)

    const updated = [...existing]
    for (const { old, new: newMem } of toUpdate) {
      const idx = updated.indexOf(old)
      if (idx >= 0) updated[idx] = newMem
    }
    for (const mem of toAdd) {
      updated.push(mem)
    }
    this.memoryStore.set(sessionId, updated)

    return {
      memories: signalMemories,
      stats: {
        newCount: toAdd.length,
        updatedCount: toUpdate.length,
        skippedCount: signalMemories.length - toAdd.length - toUpdate.length,
      },
    }
  }

  async extractFromText(
    text: string,
    sessionId: string = 'default',
  ): Promise<MemoryExtractionResult> {
    return this.extract(
      [{ role: 'user', content: text }],
      sessionId,
    )
  }

  getMemories(sessionId: string): ExtractedMemory[] {
    return this.memoryStore.get(sessionId) || []
  }

  getAllMemories(): Map<string, ExtractedMemory[]> {
    return new Map(this.memoryStore)
  }

  getMemoriesByType(sessionId: string, type: MemoryType): ExtractedMemory[] {
    return (this.memoryStore.get(sessionId) || []).filter(m => m.type === type)
  }

  clearSession(sessionId: string): void {
    this.memoryStore.delete(sessionId)
  }

  clearAll(): void {
    this.memoryStore.clear()
  }

  updateConfig(config: Partial<ExtractionConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): ExtractionConfig {
    return { ...this.config }
  }

  getStats(sessionId: string): {
    totalMemories: number
    byType: Record<string, number>
  } {
    const memories = this.memoryStore.get(sessionId) || []
    const byType: Record<string, number> = {}

    for (const mem of memories) {
      byType[mem.type] = (byType[mem.type] || 0) + 1
    }

    return {
      totalMemories: memories.length,
      byType,
    }
  }
}

export const extractMemories = new ExtractMemories()
