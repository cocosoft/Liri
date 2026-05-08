/**
 * 消息相关工具函数
 * 参考CC源码 utils/messages.ts 实现
 */

import type { Message, UserMessage, AssistantMessage, SystemMessage } from '../chat/types/message.js';
import { MessageRole, MessageType } from '../chat/types/message.js';

/**
 * 生成短消息ID（6位base36字符串）
 */
export function deriveShortMessageId(uuid: string): string {
  const hash = uuid.replace(/-/g, '');
  let num = 0;
  for (let i = 0; i < Math.min(hash.length, 12); i++) {
    num = (num * 16 + parseInt(hash[i], 16)) % (36 ** 6);
  }
  return num.toString(36).padStart(6, '0');
}

/**
 * 创建助手消息
 * @param content 消息内容
 * @returns 助手消息对象
 */
export function createAssistantMessage(content: { content: string }): AssistantMessage {
  return {
    id: `msg_${Date.now()}`,
    role: MessageRole.ASSISTANT,
    content: content.content,
    type: MessageType.NORMAL,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 创建用户消息
 * @param params 消息参数
 * @returns 用户消息对象
 */
export function createUserMessage(params: {
  content: string;
  uuid?: string;
  isMeta?: boolean;
}): UserMessage {
  return {
    id: params.uuid || `msg_${Date.now()}`,
    role: MessageRole.USER,
    content: params.content,
    type: MessageType.NORMAL,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 创建系统消息
 * @param content 消息内容
 * @param subtype 子类型
 * @returns 系统消息对象
 */
export function createSystemMessage(content: string, subtype?: string): SystemMessage {
  return {
    id: `sys_${Date.now()}`,
    role: MessageRole.SYSTEM,
    content,
    type: MessageType.SYSTEM,
    subtype,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Message;
}

/**
 * 创建离开摘要消息
 * @param text 摘要内容
 * @returns 系统消息对象
 */
export function createAwaySummaryMessage(text: string): SystemMessage {
  return createSystemMessage(text, 'away_summary');
}

/**
 * 创建压缩边界消息
 * @param params 消息参数
 * @returns 系统消息对象
 */
export function createCompactBoundaryMessage(params: {
  summary: string;
  direction?: string;
  isMicro?: boolean;
}): SystemMessage {
  const subtype = params.isMicro ? 'micro_compact_boundary' : 'compact_boundary';
  return createSystemMessage(params.summary, subtype);
}

/**
 * 创建微型压缩边界消息
 * @param summary 摘要内容
 * @returns 系统消息对象
 */
export function createMicrocompactBoundaryMessage(summary: string): SystemMessage {
  return createCompactBoundaryMessage({ summary, isMicro: true });
}

/**
 * 创建工具使用摘要消息
 * @param params 消息参数
 * @returns 工具使用摘要消息对象
 */
export function createToolUseSummaryMessage(params: {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}): Message {
  return {
    id: `tool_summary_${Date.now()}`,
    role: MessageRole.SYSTEM,
    content: `Tool: ${params.toolName}\nInput: ${JSON.stringify(params.input)}\nOutput: ${params.output}\nDuration: ${params.durationMs}ms`,
    type: MessageType.TOOL_USE_SUMMARY,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 创建内存保存消息
 * @param memoryType 内存类型
 * @param memoryId 内存ID
 * @returns 系统消息对象
 */
export function createMemorySavedMessage(memoryType: string, memoryId: string): SystemMessage {
  return createSystemMessage(`Memory saved: ${memoryType} (${memoryId})`, 'memory_saved');
}

/**
 * 创建API错误消息
 * @param error 错误信息
 * @returns 系统消息对象
 */
export function createSystemAPIErrorMessage(error: string): SystemMessage {
  return createSystemMessage(`API Error: ${error}`, 'api_error');
}

/**
 * 创建进度消息
 * @param params 进度参数
 * @returns 进度消息对象
 */
export function createProgressMessage<T extends Record<string, unknown>>(params: {
  taskId: string;
  progress: number;
  message: string;
  data?: T;
}): Message {
  return {
    id: `progress_${params.taskId}`,
    role: MessageRole.SYSTEM,
    content: params.message,
    type: MessageType.NORMAL,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {
      taskId: params.taskId,
      progress: params.progress,
      data: params.data,
    },
  };
}

/**
 * 创建命令输入消息
 * @param command 命令内容
 * @returns 系统消息对象
 */
export function createCommandInputMessage(command: string): SystemMessage {
  return createSystemMessage(`Command input: ${command}`, 'command_input');
}

/**
 * 创建用户中断消息
 * @param reason 中断原因
 * @returns 用户消息对象
 */
export function createUserInterruptionMessage(reason?: string): UserMessage {
  return createUserMessage({
    content: reason || 'User interrupted',
    isMeta: true,
  });
}

/**
 * 创建合成用户警告消息
 * @returns 用户消息对象
 */
export function createSyntheticUserCaveatMessage(): UserMessage {
  return createUserMessage({
    content: '[Synthetic: User preference noted]',
    isMeta: true,
  });
}

/**
 * 创建代理终止消息
 * @returns 系统消息对象
 */
export function createAgentsKilledMessage(): SystemMessage {
  return createSystemMessage('Agents killed', 'agents_killed');
}

/**
 * 创建权限重试消息
 * @param permissionType 权限类型
 * @returns 系统消息对象
 */
export function createPermissionRetryMessage(permissionType: string): SystemMessage {
  return createSystemMessage(`Retrying permission check for: ${permissionType}`, 'permission_retry');
}

/**
 * 创建桥接状态消息
 * @param status 状态信息
 * @returns 系统消息对象
 */
export function createBridgeStatusMessage(status: Record<string, unknown>): SystemMessage {
  return createSystemMessage(`Bridge status: ${JSON.stringify(status)}`, 'bridge_status');
}

/**
 * 创建定时任务触发消息
 * @param taskId 任务ID
 * @returns 系统消息对象
 */
export function createScheduledTaskFireMessage(taskId: string): SystemMessage {
  return createSystemMessage(`Scheduled task fired: ${taskId}`, 'scheduled_task_fire');
}

/**
 * 创建停止钩子摘要消息
 * @param info 钩子信息
 * @returns 系统消息对象
 */
export function createStopHookSummaryMessage(info: Record<string, unknown>): SystemMessage {
  return createSystemMessage(`Stop hook summary: ${JSON.stringify(info)}`, 'stop_hook_summary');
}

/**
 * 创建轮次时长消息
 * @param durationMs 时长（毫秒）
 * @returns 系统消息对象
 */
export function createTurnDurationMessage(durationMs: number): SystemMessage {
  return createSystemMessage(`Turn duration: ${durationMs}ms`, 'turn_duration');
}

/**
 * 创建API指标消息
 * @param metrics 指标数据
 * @returns 系统消息对象
 */
export function createApiMetricsMessage(metrics: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}): SystemMessage {
  return createSystemMessage(
    `API Metrics: Prompt=${metrics.promptTokens}, Completion=${metrics.completionTokens}, Total=${metrics.totalTokens}, Latency=${metrics.latencyMs}ms`,
    'api_metrics'
  );
}

/**
 * 创建助手API错误消息
 * @param error 错误信息
 * @returns 助手消息对象
 */
export function createAssistantAPIErrorMessage(error: string): AssistantMessage {
  return {
    id: `api_error_${Date.now()}`,
    role: MessageRole.ASSISTANT,
    content: `Error: ${error}`,
    type: MessageType.NORMAL,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 创建工具结果停止消息
 * @param toolName 工具名称
 * @returns 系统消息对象
 */
export function createToolResultStopMessage(toolName: string): SystemMessage {
  return createSystemMessage(`Tool result stopped: ${toolName}`, 'tool_result_stop');
}

/**
 * 检查消息是否是合成消息
 * @param message 消息对象
 * @returns 是否是合成消息
 */
export function isSyntheticMessage(message: Message): boolean {
  return !!(message as any).isMeta || !!(message as any).isCompactSummary;
}

/**
 * 获取助手消息文本
 * @param message 消息对象
 * @returns 消息文本
 */
export function getAssistantMessageText(message: Message): string {
  if (message.role !== MessageRole.ASSISTANT) return '';
  if (typeof message.content === 'string') return message.content;
  return '';
}

/**
 * 计算工具调用次数
 * @param messages 消息列表
 * @returns 工具调用次数
 */
export function countToolCalls(messages: Message[]): number {
  return messages.filter(m => (m as any).type === 'tool_use').length;
}

/**
 * 提取标签内容
 * @param text 文本内容
 * @param tagName 标签名称
 * @returns 标签内容
 */
export function extractTag(text: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, 's');
  const match = text.match(regex);
  return match ? match[1] : null;
}

/**
 * 检查消息文本是否为空
 * @param text 文本内容
 * @returns 是否为空
 */
export function isEmptyMessageText(text: string | undefined): boolean {
  return !text || text.trim().length === 0;
}
