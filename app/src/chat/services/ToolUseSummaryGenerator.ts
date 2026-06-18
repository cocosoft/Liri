/**
 * 工具使用摘要生成器
 * 参考CC源码 services/toolUseSummary/toolUseSummaryGenerator.ts 实现
 */

import { getLogger } from '@modules/monitoring/logs/Logger';

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

  try {
    // 构建工具摘要
    const toolSummaries = tools
      .map((tool) => {
        const inputStr = truncateJson(tool.input, 300);
        const outputStr = truncateJson(tool.output, 300);
        const durationStr = tool.durationMs
          ? `\nDuration: ${tool.durationMs}ms`
          : '';
        return `Tool: ${tool.name}\nInput: ${inputStr}\nOutput: ${outputStr}${durationStr}`;
      })
      .join('\n\n');

    const contextPrefix = lastAssistantText
      ? `User's intent (from assistant's last message): ${lastAssistantText.slice(0, 200)}\n\n`
      : '';

    // 构建完整提示
    const prompt = `${contextPrefix}Tools completed:\n\n${toolSummaries}\n\nLabel:`;

    // 模拟AI调用生成摘要（实际使用时需要调用真实的AI模型）
    const mockSummary = generateMockSummary(tools);

    // 检查信号是否已中止
    if (signal?.aborted) {
      return null;
    }

    return mockSummary;
  } catch (error) {
    // 日志记录但不抛出错误 - 摘要是非关键功能
    logger.debug('摘要生成失败', { error: String(error) });
    return null;
  }
}

/**
 * 生成模拟摘要（用于演示）
 * @param tools 工具列表
 * @returns 模拟摘要
 */
function generateMockSummary(tools: ToolInfo[]): string {
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

  const tool = tools[0];
  const toolName = tool.name.toLowerCase();

  // 尝试从工具名称中提取动作
  let action = 'Used';
  for (const [keyword, verb] of Object.entries(actions)) {
    if (toolName.includes(keyword)) {
      action = verb;
      break;
    }
  }

  // 提取输入信息
  let target = '';
  if (tool.input && typeof tool.input === 'object') {
    const inputObj = tool.input as Record<string, unknown>;
    target = inputObj['file'] || inputObj['path'] || inputObj['query'] || '';
    if (typeof target === 'string') {
      // 只保留文件名或简短描述
      target = target.split('/').pop() || target;
      if (target.length > 20) {
        target = target.slice(0, 20) + '...';
      }
    } else {
      target = '';
    }
  }

  if (target) {
    return `${action} ${target}`;
  }
  return `${action} ${tool.name}`;
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
