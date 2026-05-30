/**
 * Cron 调度系统类型定义
 */

/** 调度种类 */
export type ScheduleKind = 'once' | 'interval' | 'cron';

/** 解析后的调度信息 */
export interface CronSchedule {
  kind: ScheduleKind;
  display: string;
  /** 仅 kind='once' 时有效：ISO 时间戳 */
  runAt?: string;
  /** 仅 kind='interval' 时有效：间隔分钟数 */
  minutes?: number;
  /** 仅 kind='cron' 时有效：cron 表达式 */
  expr?: string;
}

/** 重复策略 */
export interface CronRepeat {
  /** 总执行次数（null 表示无限） */
  times: number | null;
  /** 已完成次数 */
  completed: number;
}

/** 任务来源信息（用于 origin 交付） */
export interface CronOrigin {
  platform: string;
  chatId: string;
  chatName?: string;
  threadId?: string;
}

/** Cron 作业状态 */
export type CronJobState =
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'paused'
  | 'failed';

/**
 * 合法状态转移表
 * key: 当前状态, value: 允许转移到的目标状态集合
 */
export const CRON_JOB_STATE_TRANSITIONS: Record<CronJobState, CronJobState[]> = {
  scheduled: ['running', 'paused', 'completed', 'failed'],
  running:   ['completed', 'failed', 'paused'],
  paused:    ['scheduled', 'completed', 'failed'],
  completed: [],
  failed:    ['scheduled', 'paused', 'completed'],
};

/** 判断是否为终止状态 */
export function isTerminalCronState(state: CronJobState): boolean {
  return state === 'completed';
}

/** 判断状态转移是否合法 */
export function isValidCronTransition(from: CronJobState, to: CronJobState): boolean {
  return CRON_JOB_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 验证状态转移，非法时抛出错误 */
export function validateCronTransition(from: CronJobState, to: CronJobState): void {
  if (!isValidCronTransition(from, to)) {
    throw new Error(
      `非法状态转移: ${from} → ${to}，允许的目标: [${CRON_JOB_STATE_TRANSITIONS[from]?.join(', ') ?? '无'}]`,
    );
  }
}

/** Cron 作业运行状态 */
export type CronRunStatus = 'ok' | 'failed';

/** Cron 作业 */
export interface CronJob {
  id: string;
  name: string;
  prompt?: string;
  skills: string[];
  skill?: string;
  schedule: CronSchedule;
  scheduleDisplay?: string;
  repeat: CronRepeat;
  enabled: boolean;
  state: CronJobState;
  pausedAt?: number;
  pausedReason?: string;
  createdAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: CronRunStatus;
  lastError?: string;
  lastDeliveryError?: string;
  deliver: string;
  origin?: CronOrigin;
  /** 投递目标平台 */
  enabledToolsets?: string[];
  workdir?: string;
  /** per-job 模型覆盖 */
  model?: string;
  provider?: string;
  baseUrl?: string;
  /** 数据采集脚本路径 */
  script?: string;
  /** 无 Agent 模式（脚本输出直投） */
  noAgent?: boolean;
  /** 前置任务 ID 列表 */
  contextFrom?: string[];
  /** 归属用户/Agent Key */
  ownerKey?: string;
  /** 归属会话 Key */
  sessionKey?: string;
}

/** 调度锁 */
export interface CronLock {
  pid: number;
  identity: string;
  acquiredAt: number;
}

/** 调度器配置 */
export interface CronSchedulerConfig {
  /** 检查间隔（毫秒） */
  checkIntervalMs?: number;
  /** 最大并行作业数 */
  maxParallelJobs?: number;
  /** 任务超时时间（毫秒） */
  jobTimeoutMs?: number;
  /** 是否启用文件锁 */
  enableLock?: boolean;
  /** 锁身份标识 */
  lockIdentity?: string;
  /** 工作目录 */
  workdir?: string;
}

/** 作业执行结果 */
export interface CronJobResult {
  success: boolean;
  output: string;
  finalResponse: string;
  error?: string;
  durationMs: number;
}

/** 调度器接口 */
export interface ICronScheduler {
  start(): void;
  stop(): void;
  tick(): Promise<number>;
  getStatus(): CronSchedulerStatus;
}

/** 调度器状态 */
export interface CronSchedulerStatus {
  running: boolean;
  lastTickAt?: number;
  activeJobs: number;
  totalJobs: number;
  uptimeMs: number;
}

/** 作业过滤器 */
export interface CronJobFilter {
  enabled?: boolean;
  state?: CronJobState;
  skill?: string;
  ids?: string[];
  ownerKey?: string;
  sessionKey?: string;
}
