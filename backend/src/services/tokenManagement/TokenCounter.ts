//
export const CHARS_PER_TOKEN = 4

export const TOKEN_ESTIMATION_OFFSET = 3

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export interface TokenCountResult {
  estimatedTokens: number
  apiReportedTokens: number | null
  method: 'api' | 'estimation'
}

export function roughTokenCountEstimation(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function roughTokenCountForMessages(
  messages: readonly { content?: string | unknown; role?: string }[],
): number {
  let total = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += roughTokenCountEstimation(message.content)
    } else if (typeof message.content === 'object' && message.content !== null) {
      total += roughTokenCountEstimation(JSON.stringify(message.content))
    }
    total += TOKEN_ESTIMATION_OFFSET
  }
  return total
}

export function tokenCountWithEstimation(
  messages: ReadonlyArray<{ content?: string | unknown; role?: string }>,
  apiReportedTokens: number | null = null,
): number {
  if (apiReportedTokens !== null && apiReportedTokens > 0) {
    return apiReportedTokens
  }
  return roughTokenCountForMessages(messages)
}

export function getTokenCountFromUsage(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  )
}

export function getCurrentUsage(
  messages: Array<{ usage?: TokenUsage }>,
): TokenUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.usage) {
      return message.usage
    }
  }
  return null
}

export function doesExceedTokenThreshold(
  totalTokens: number,
  threshold: number,
): boolean {
  return totalTokens > threshold
}

export const TOKEN_THRESHOLD_200K = 200_000

export function doesMostRecentExceed200k(
  messages: Array<{ usage?: TokenUsage }>,
): boolean {
  const usage = getCurrentUsage(messages)
  if (!usage) return false
  return getTokenCountFromUsage(usage) > TOKEN_THRESHOLD_200K
}

export function getAssistantMessageContentLength(
  message: { content?: string | Array<{ type: string; text?: string; thinking?: string; data?: string; input?: unknown }> },
): number {
  let length = 0
  const content = message.content
  if (!content) return 0

  if (typeof content === 'string') {
    return content.length
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        length += block.text.length
      } else if (block.type === 'thinking' && block.thinking) {
        length += block.thinking.length
      } else if (block.type === 'redacted_thinking' && block.data) {
        length += block.data.length
      } else if (block.type === 'tool_use' && block.input) {
        length += JSON.stringify(block.input).length
      }
    }
  }

  return length
}

export function calculateTokenEstimateFromUsage(
  usage: TokenUsage,
  additionalMessages: Array<{ content?: string | unknown }> = [],
): number {
  const apiTokens = getTokenCountFromUsage(usage)
  const estimatedNew = roughTokenCountForMessages(additionalMessages)
  return apiTokens + estimatedNew
}
