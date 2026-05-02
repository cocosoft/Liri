export type PIIMatch = {
  type: 'email' | 'phone' | 'credit_card' | 'ssn' | 'api_key' | 'ip_address' | 'token'
  match: string
  start: number
  end: number
}

export type AnonymizationResult = {
  originalText: string
  sanitizedText: string
  matches: PIIMatch[]
  wasModified: boolean
}

export type AnonymizationOptions = {
  enabled: boolean
  replacementStrategy: 'mask' | 'hash' | 'redact'
  patterns: RegExp[]
}

export const PII_PATTERNS: Array<{ type: PIIMatch['type']; pattern: RegExp }> = [
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: 'phone',
    pattern: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  },
  {
    type: 'credit_card',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  },
  {
    type: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: 'api_key',
    pattern: /\b(?:sk|api|key|token|secret)[-_]?[a-zA-Z0-9]{16,}\b/gi,
  },
  {
    type: 'ip_address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  },
  {
    type: 'token',
    pattern: /\b(?:eyJ|ghp_|gho_|github_pat_|xox[bpras]-)[a-zA-Z0-9_-]{20,}\b/g,
  },
]

export class AnonymizationPipeline {
  private options: AnonymizationOptions
  private stats = {
    totalProcessed: 0,
    totalModified: 0,
    totalMatches: 0,
  }

  constructor(options?: Partial<AnonymizationOptions>) {
    this.options = {
      enabled: options?.enabled !== false,
      replacementStrategy: options?.replacementStrategy || 'redact',
      patterns: options?.patterns || PII_PATTERNS.map(p => p.pattern),
    }
  }

  get isEnabled(): boolean {
    return this.options.enabled
  }

  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled
  }

  anonymize(text: string): AnonymizationResult {
    const matches: PIIMatch[] = []

    for (const piiEntry of PII_PATTERNS) {
      const regex = new RegExp(piiEntry.pattern.source, piiEntry.pattern.flags)
      let match: RegExpExecArray | null

      while ((match = regex.exec(text)) !== null) {
        matches.push({
          type: piiEntry.type,
          match: match[0],
          start: match.index,
          end: match.index + match[0].length,
        })
      }
    }

    if (matches.length === 0) {
      return {
        originalText: text,
        sanitizedText: text,
        matches: [],
        wasModified: false,
      }
    }

    matches.sort((a, b) => b.start - a.start)

    let sanitized = text
    for (const match of matches) {
      const replacement = this.buildReplacement(match)
      sanitized = sanitized.slice(0, match.start) + replacement + sanitized.slice(match.end)
    }

    this.stats.totalProcessed++
    this.stats.totalModified++
    this.stats.totalMatches += matches.length

    return {
      originalText: text,
      sanitizedText: sanitized,
      matches,
      wasModified: true,
    }
  }

  private buildReplacement(match: PIIMatch): string {
    switch (this.options.replacementStrategy) {
      case 'mask':
        if (match.match.length <= 4) return '****'
        return match.match.slice(0, 2) + '****' + match.match.slice(-2)
      case 'hash':
        return `[${match.type}:${hashSimple(match.match)}]`
      case 'redact':
      default:
        return `[REDACTED_${match.type.toUpperCase()}]`
    }
  }

  anonymizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string') {
        const anon = this.anonymize(value)
        result[key] = anon.wasModified ? anon.sanitizedText : value
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.anonymizeMetadata(value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }
    return result
  }

  getStats(): typeof this.stats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = { totalProcessed: 0, totalModified: 0, totalMatches: 0 }
  }
}

function hashSimple(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(16).slice(0, 8)
}

export function createAnonymizationPipeline(options?: Partial<AnonymizationOptions>): AnonymizationPipeline {
  return new AnonymizationPipeline(options)
}
