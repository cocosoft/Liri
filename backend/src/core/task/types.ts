/**
 * 任务类型定义和ID生成器
 * 参考CC源码 cc_code/backend/Task.ts 实现
 * 包括：任务类型、任务状态、任务ID生成、任务状态基类
 */

import { randomBytes } from 'crypto';

/**
 * 任务类型枚举
 * 基于CC源码的任务类型系统
 */
export type TaskType =
  | 'local_bash'
  | 'local_agent'
  | 'remote_agent'
  | 'in_process_teammate'
  | 'local_workflow'
  | 'monitor_mcp'
  | 'dream';

/**
 * 任务状态枚举
 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed';

/**
 * 判断任务是否处于终态（不再转换）
 * 用于防止向已终止的任务注入消息
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed';
}

/**
 * 任务句柄
 */
export interface TaskHandle {
  taskId: string;
  cleanup?: () => void;
}

/**
 * 任务上下文
 */
export interface TaskContext {
  abortController: AbortController;
  getAppState: () => unknown;
  setAppState: (updater: (prev: unknown) => unknown) => void;
}

/**
 * 任务状态基类
 * 所有任务类型共享的基础字段
 */
export interface TaskStateBase {
  id: string;
  type: TaskType;
  status: TaskStatus;
  description: string;
  toolUseId?: string;
  startTime: number;
  endTime?: number;
  totalPausedMs?: number;
  outputFile: string;
  outputOffset: number;
  notified: boolean;
}

/**
 * 本地Shell任务输入
 */
export interface LocalShellSpawnInput {
  command: string;
  description: string;
  timeout?: number;
  toolUseId?: string;
  agentId?: string;
  kind?: 'bash' | 'monitor';
}

/**
 * 任务接口
 * 用于多态任务管理
 */
export interface Task {
  name: string;
  type: TaskType;
  kill(
    taskId: string,
    setAppState: (updater: (prev: unknown) => unknown) => void
  ): Promise<void>;
}

/**
 * 任务ID前缀映射
 * 每个任务类型有唯一的前缀标识
 */
const TASK_ID_PREFIXES: Record<TaskType, string> = {
  local_bash: 'b',
  local_agent: 'a',
  remote_agent: 'r',
  in_process_teammate: 't',
  local_workflow: 'w',
  monitor_mcp: 'm',
  dream: 'd',
};

/**
 * 获取任务ID前缀
 */
export function getTaskIdPrefix(type: TaskType): string {
  return TASK_ID_PREFIXES[type] ?? 'x';
}

/**
 * 任务ID字母表
 * 36^8 ≈ 2.8万亿种组合，足够抵抗暴力攻击
 */
const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * 生成任务ID
 * 格式：{prefix}{8位随机字符}
 * 例如：b3x7k9m2p
 */
export function generateTaskId(type: TaskType): string {
  const prefix = getTaskIdPrefix(type);
  const bytes = randomBytes(8);
  let id = prefix;
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % TASK_ID_ALPHABET.length];
  }
  return id;
}

/**
 * 创建任务状态基类
 */
export function createTaskStateBase(
  id: string,
  type: TaskType,
  description: string,
  toolUseId?: string
): TaskStateBase {
  return {
    id,
    type,
    status: 'pending',
    description,
    toolUseId,
    startTime: Date.now(),
    outputFile: `/tmp/tasks/${id}/output.log`,
    outputOffset: 0,
    notified: false,
  };
}

/**
 * 所有任务类型列表
 */
export const TASK_TYPES: TaskType[] = [
  'local_bash',
  'local_agent',
  'remote_agent',
  'in_process_teammate',
  'local_workflow',
  'monitor_mcp',
  'dream',
];

/**
 * 所有任务状态列表
 */
export const TASK_STATUSES: TaskStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'killed',
];
