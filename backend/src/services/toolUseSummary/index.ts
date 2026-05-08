//
/**
 * 工具使用摘要服务
 *
 * 为工具调用生成人类可读的摘要文本。
 * 用于流式输出、会话记录和用户界面展示。
 */

/**
 * 工具调用信息
 */
export interface ToolUseInfo {
  name: string
  input: Record<string, unknown>
  output?: unknown
}

/**
 * 工具使用摘要生成选项
 */
export interface ToolUseSummaryOptions {
  tools: ToolUseInfo[]
  signal?: AbortSignal
  isNonInteractiveSession?: boolean
  lastAssistantText?: string
}

/**
 * 工具名称 -> 动词映射
 */
const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  Bash: 'Running',
  Glob: 'Searching',
  Grep: 'Searching',
  FileRead: 'Reading',
  FileWrite: 'Writing',
  FileEdit: 'Editing',
  GlobTool: 'Searching',
  GrepTool: 'Searching',
  BashTool: 'Running',
  NotebookEditTool: 'Editing notebook',
  LSP: 'LSP',
  Task: 'Running task',
  Agent: 'Running agent',
  Skill: 'Running skill',
  WebSearch: 'Searching web',
  WebFetch: 'Fetching URL',
}

/**
 * 为单个工具调用生成摘要文本
 *
 * @param name - 工具名称
 * @param input - 工具输入
 * @returns 人类可读的摘要字符串
 */
export function toolSummary(
  name: string,
  input: Record<string, unknown>
): string {
  const verb = TOOL_VERBS[name] ?? name

  const target =
    (input.file_path as string) ??
    (input.filePath as string) ??
    (input.pattern as string) ??
    (typeof input.command === 'string' ? input.command.slice(0, 60) : undefined) ??
    (input.url as string) ??
    (input.query as string) ??
    ''

  if (target) {
    return `${verb} ${target}`
  }

  return verb
}

/**
 * 合并工具摘要为自然语言描述
 *
 * 将多个工具调用摘要合并为一段语义化的描述文本。
 * 示例：
 * - "Read 2 files, ran 1 command"
 * - "Edited 3 files"
 *
 * @param tools - 工具调用列表
 * @returns 合并后的摘要文本
 */
export function mergeToolSummaries(tools: ToolUseInfo[]): string {
  if (tools.length === 0) return ''

  const verbCount: Record<string, number> = {}
  const targets: string[] = []

  for (const tool of tools) {
    const summary = toolSummary(tool.name, tool.input)
    const verb = TOOL_VERBS[tool.name] ?? tool.name

    verbCount[verb] = (verbCount[verb] ?? 0) + 1

    if (targets.length < 3) {
      const target = tool.input.file_path ??
        tool.input.filePath ??
        tool.input.url as string ?? undefined
      if (target && !targets.includes(target)) {
        targets.push(target)
      }
    }
  }

  const parts = Object.entries(verbCount).map(([verb, count]) => {
    return `${verb} ${count} ${count > 1 ? 'files/tasks' : 'file/task'}`
  })

  let result = parts.join(', ')

  if (targets.length > 0) {
    result += ` (${targets.join(', ')})`
  }

  return result
}

/**
 * 生成工具使用摘要
 *
 * 分析当前轮次的工具调用，生成语义化的摘要文本。
 * 用于压缩历史记录以减少 Token 消耗。
 *
 * @param options - 摘要生成选项
 * @returns 摘要文本，失败时返回 null
 */
export async function generateToolUseSummary(
  options: ToolUseSummaryOptions
): Promise<string | null> {
  const { tools, signal } = options

  if (tools.length === 0 || signal?.aborted) return null

  try {
    const summary = mergeToolSummaries(tools)

    // 如果摘要为空或过于简单，尝试更详细的分析
    if (!summary || summary.length < 10) {
      return buildDetailedSummary(tools)
    }

    return summary
  } catch {
    return buildDetailedSummary(tools)
  }
}

/**
 * 构建详细的工具使用摘要
 */
function buildDetailedSummary(tools: ToolUseInfo[]): string {
  const readTools = tools.filter(t => {
    const v = TOOL_VERBS[t.name] ?? ''
    return v === 'Reading' || v === 'Searching'
  })

  const writeTools = tools.filter(t => {
    const v = TOOL_VERBS[t.name] ?? ''
    return v === 'Writing' || v === 'Editing'
  })

  const bashTools = tools.filter(t => {
    const v = TOOL_VERBS[t.name] ?? ''
    return v === 'Running'
  })

  const parts: string[] = []

  if (readTools.length > 0) {
    const files = readTools
      .map(t => t.input.file_path ?? t.input.filePath ?? t.input.pattern)
      .filter(Boolean) as string[]
    parts.push(
      files.length > 0
        ? `Read ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`
        : `Used ${readTools.length} read/search tools`
    )
  }

  if (writeTools.length > 0) {
    const files = writeTools
      .map(t => t.input.file_path ?? t.input.filePath)
      .filter(Boolean) as string[]
    parts.push(
      files.length > 0
        ? `Modified ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`
        : `Used ${writeTools.length} write/edit tools`
    )
  }

  if (bashTools.length > 0) {
    const commands = bashTools
      .map(t => {
        const cmd = t.input.command as string | undefined
        return cmd ? cmd.slice(0, 40) : undefined
      })
      .filter(Boolean) as string[]
    parts.push(
      commands.length > 0
        ? `Ran: ${commands.slice(0, 2).join('; ')}`
        : `Ran ${bashTools.length} commands`
    )
  }

  return parts.join('; ') || `Used ${tools.length} tools`
}

/**
 * 从工具摘要创建系统消息
 *
 * 包装摘要文本为系统消息对象。
 *
 * @param summary - 摘要文本
 * @param toolUseIds - 工具调用 ID 列表
 * @returns 系统消息
 */
export function createToolUseSummaryMessage(
  summary: string,
  toolUseIds: string[]
): {
  type: 'system'
  subtype: 'tool_use_summary'
  content: string
  toolUseIds: string[]
} {
  return {
    type: 'system',
    subtype: 'tool_use_summary',
    content: summary,
    toolUseIds,
  }
}

/**
 * 创建流线型工具摘要消息（SDK 输出用）
 *
 * @param summary - 摘要文本
 * @param sessionId - 会话 ID
 * @returns 流线型消息对象
 */
export function createStreamlinedToolUseSummary(
  summary: string,
  sessionId: string
): {
  type: 'streamlined_tool_use_summary'
  tool_summary: string
  session_id: string
  uuid: string
} {
  return {
    type: 'streamlined_tool_use_summary',
    tool_summary: summary,
    session_id: sessionId,
    uuid: crypto.randomUUID(),
  }
}
