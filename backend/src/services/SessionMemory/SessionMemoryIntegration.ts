/**
 * SessionMemory 会话生命周期集成
 *
 * 将 SessionMemory 服务集成到会话创建和关闭生命周期中
 * - 会话结束时自动提取记忆
 * - 会话创建时加载历史记忆上下文
 * - 定时清理过期记忆
 *
 * 参考: cc_code/backend/services/SessionMemory/
 */

import type { Session } from '@modules/session/models/Session'
import type { SessionMessage } from '@modules/session/models/SessionMessage'
import {
  SessionMemoryServiceImpl,
  type SessionMemoryService,
  type SessionMemorySummary,
} from './SessionMemoryService'
import { extractSessionMemoryFromMessages } from './SessionMemoryUtils'

export type SessionMemoryIntegrationConfig = {
  autoExtractOnClose: boolean
  loadContextOnOpen: boolean
  cleanupDays: number
  maxContextItems: number
}

const DEFAULT_CONFIG: SessionMemoryIntegrationConfig = {
  autoExtractOnClose: true,
  loadContextOnOpen: true,
  cleanupDays: 30,
  maxContextItems: 10,
}

let memoryService: SessionMemoryService | null = null
let config: SessionMemoryIntegrationConfig = { ...DEFAULT_CONFIG }

export function getSessionMemoryService(): SessionMemoryService {
  if (!memoryService) {
    memoryService = new SessionMemoryServiceImpl()
  }
  return memoryService
}

export function configureSessionMemoryIntegration(
  partialConfig: Partial<SessionMemoryIntegrationConfig>,
): void {
  config = { ...config, ...partialConfig }
}

/**
 * 会话关闭时提取记忆
 * 应在 session close/end 事件中调用
 */
export async function onSessionClose(
  sessionId: string,
  messages: SessionMessage[],
): Promise<SessionMemorySummary | null> {
  if (!config.autoExtractOnClose || messages.length === 0) {
    return null
  }

  const service = getSessionMemoryService()
  return service.updateSessionSummary(sessionId, messages)
}

/**
 * 会话创建时加载历史记忆上下文
 * 应在 session create/start 事件中调用
 */
export async function onSessionOpen(
  sessionId: string,
): Promise<string | null> {
  if (!config.loadContextOnOpen) {
    return null
  }

  const service = getSessionMemoryService()
  const summary = await service.getSessionSummary(sessionId)
  if (!summary) return null

  return formatMemoryContext(summary)
}

/**
 * 格式化记忆上下文为系统提示词注入
 */
function formatMemoryContext(summary: SessionMemorySummary): string {
  const lines: string[] = ['=== Previous Session Context ===']

  if (summary.title) {
    lines.push(`Previous session: ${summary.title}`)
  }

  const items = [
    ...summary.decisions.slice(0, 3),
    ...summary.insights.slice(0, 3),
    ...summary.tasks.slice(0, 3),
  ].slice(0, config.maxContextItems)

  if (items.length > 0) {
    lines.push('')
    lines.push('Key items from previous session:')
    for (const item of items) {
      const typeLabel =
        item.type === 'decision'
          ? 'Decision'
          : item.type === 'insight'
            ? 'Insight'
            : item.type === 'task'
              ? 'Task'
              : item.type
      lines.push(`- [${typeLabel}] ${item.content.slice(0, 200)}`)
    }
  }

  lines.push('')
  lines.push('Use this context to provide continuity between sessions.')
  lines.push('=== End Previous Session Context ===')

  return lines.join('\n')
}

/**
 * 定期清理过期记忆
 */
export async function cleanupSessionMemory(): Promise<void> {
  const service = getSessionMemoryService()
  await service.cleanupOldSessionMemory(config.cleanupDays)
}

/**
 * 从消息中实时提取并存储会话记忆
 * 可在每条消息后调用以增量更新
 */
export async function extractAndStoreMemory(
  sessionId: string,
  messages: SessionMessage[],
): Promise<void> {
  if (messages.length < 3) return

  const service = getSessionMemoryService()
  const extracted = extractSessionMemoryFromMessages(messages.slice(-5))
  if (extracted.length === 0) return

  try {
    await service.updateSessionSummary(sessionId, messages)
  } catch {
    // silently ignore extraction errors
  }
}
