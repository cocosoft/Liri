/**
 * Fork Subagent 实现
 *
 * 当不指定 subagent_type 时触发隐式 fork：
 * 子代理继承父代理的完整对话上下文和系统提示词。
 *
 * 参考：cc_code/backend/tools/AgentTool/forkSubagent.ts
 */

export const FORK_SUBAGENT_TYPE = 'fork'
export const FORK_DIRECTIVE_PREFIX = 'FORK:'
export const FORK_BOILERPLATE_TAG = '[fork-subagent]'

export interface ForkSubagentOptions {
  /** 父代理的系统提示词字节 */
  renderedSystemPrompt: string
  /** 父代理的对话消息列表 */
  parentMessages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  /** fork 指令 */
  directive?: string
  /** 最大轮次（默认 200） */
  maxTurns?: number
}

export interface ForkSubagentResult {
  taskId: string
  completed: boolean
  result?: string
  error?: string
}

export function isForkSubagentEnabled(): boolean {
  // 默认启用，可通过环境变量控制
  const disabled = process.env.DISABLE_FORK_SUBAGENT === 'true'
  return !disabled
}

export function isInForkChild(
  messages: Array<{ role: string; content: string }>,
): boolean {
  return messages.some(
    (m) =>
      m.role === 'user' &&
      m.content.includes(FORK_BOILERPLATE_TAG),
  )
}

export function buildForkSystemPrompt(
  parentSystemPrompt: string,
  options: ForkSubagentOptions,
): string {
  const prompt = [parentSystemPrompt]

  if (options.directive) {
    prompt.push('')
    prompt.push(FORK_DIRECTIVE_PREFIX + ' ' + options.directive)
  }

  prompt.push('')
  prompt.push('[You are a forked sub-agent operating in the same session context as the parent agent.]')

  return prompt.join('\n')
}

export function buildForkContextMessages(
  parentMessages: ForkSubagentOptions['parentMessages'],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const contextMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
    []

  const recent = parentMessages.slice(-30)

  for (const msg of recent) {
    contextMessages.push(msg)
  }

  contextMessages.push({
    role: 'user',
    content: `${FORK_BOILERPLATE_TAG} This is a forked sub-agent session. Continue the task autonomously.`,
  })

  return contextMessages
}

export function formatForkAgentDefinition(): {
  agentType: string
  whenToUse: string
  maxTurns: number
  model: string
  permissionMode: string
} {
  return {
    agentType: FORK_SUBAGENT_TYPE,
    whenToUse:
      'Implicit fork — inherits full conversation context. Not selectable via subagent_type; triggered by omitting subagent_type when fork is enabled.',
    maxTurns: 200,
    model: 'inherit',
    permissionMode: 'bubble',
  }
}
