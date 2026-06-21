/**
 * 工具使用摘要生成器
 * 参考CC源码 services/toolUseSummary/toolUseSummaryGenerator.ts 实现
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('ToolUseSummaryGenerator');

export interface ToolInfo {
  name: string;
  input: unknown;
  output: unknown;
  durationMs?: number;
}

export interface GenerateToolUseSummaryParams {
  tools: ToolInfo[];
  signal?: AbortSignal;
  isNonInteractiveSession?: boolean;
  lastAssistantText?: string;
}

const TOOL_USE_SUMMARY_SYSTEM_PROMPT = `Write a short summary label describing what these tool calls accomplished. It appears as a single-line row in a mobile app and truncates around 30 characters, so think git-commit-subject, not sentence.

Keep the verb in past tense and the most distinctive noun. Drop articles, connectors, and long location context first.

Examples:
- Searched in auth/
- Fixed NPE in UserService
- Created signup endpoint
- Read config.json
- Ran failing tests`;

/**
 * 截断JSON值到最大长度
 * @param value JSON值
 * @param maxLength 最大长度
 * @returns 截断后的字符串
 */
function truncateJson(value: unknown, maxLength: number): string {
  try {
    const str = JSON.stringify(value);
    if (str.length <= maxLength) {
      return str;
    }
    return str.slice(0, maxLength - 3) + '...';
  } catch {
    return String(value);
  }
}

/**
 * 根据工具名称提取动作动词
 * @param toolName 工具名称
 * @returns 动作动词
 */
function extractAction(toolName: string): string {
  const actions: Record<string, string> = {
    read: 'Read',
    write: 'Wrote',
    search: 'Searched',
    create: 'Created',
    delete: 'Deleted',
    update: 'Updated',
    run: 'Ran',
    list: 'Listed',
    check: 'Checked',
    fix: 'Fixed',
  };

  const toolNameLower = toolName.toLowerCase();
  for (const [keyword, verb] of Object.entries(actions)) {
    if (toolNameLower.includes(keyword)) {
      return verb;
    }
  }
  return 'Used';
}

/**
 * 从输入对象中提取目标信息
 * @param input 工具输入
 * @returns 目标字符串
 */
function extractTarget(input: unknown): string {
  if (!input || typeof input !== 'object') {
    return '';
  }

  const inputObj = input as Record<string, unknown>;
  const target = (inputObj['file'] ||
    inputObj['path'] ||
    inputObj['query'] ||
    inputObj['name'] ||
    '') as string;

  if (typeof target === 'string') {
    const shortTarget = target.split('/').pop() || target;
    if (shortTarget.length > 20) {
      return shortTarget.slice(0, 20) + '...';
    }
    return shortTarget;
  }

  return '';
}

/**
 * 生成工具使用摘要
 * @param params 参数
 * @returns 摘要字符串或null
 */
export async function generateToolUseSummary({
  tools,
  signal,
  isNonInteractiveSession,
  lastAssistantText,
}: GenerateToolUseSummaryParams): Promise<string | null> {
  if (tools.length === 0) {
    return null;
  }

  if (signal?.aborted) {
    return null;
  }

  try {
    const tool = tools[0];
    const action = extractAction(tool.name);
    const target = extractTarget(tool.input);

    if (target) {
      return `${action} ${target}`;
    }
    return `${action} ${tool.name}`;
  } catch (error) {
    logger.debug('摘要生成失败', { error: String(error) });
    return null;
  }
}

/**
 * 批量生成工具使用摘要
 * @param toolBatches 工具批次
 * @param signal 中止信号
 * @returns 摘要列表
 */
export async function generateToolUseSummaries(
  toolBatches: ToolInfo[][],
  signal?: AbortSignal
): Promise<(string | null)[]> {
  const results: (string | null)[] = [];

  for (const batch of toolBatches) {
    if (signal?.aborted) {
      break;
    }
    const summary = await generateToolUseSummary({ tools: batch, signal });
    results.push(summary);
  }

  return results;
}
