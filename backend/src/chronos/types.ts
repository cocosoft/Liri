/**
 * Chronos定时任务类型定义
 */

/**
 * 定时任务状态
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 定时任务
 */
export interface ScheduledTask {
  /**
   * 任务ID (8位UUID)
   */
  id: string;

  /**
   * cron表达式
   */
  cron: string;

  /**
   * 执行的prompt
   */
  prompt: string;

  /**
   * 创建时间戳
   */
  createdAt: number;

  /**
   * 最后触发时间
   */
  lastFiredAt?: number;

  /**
   * 是否循环任务
   */
  recurring: boolean;

  /**
   * 永久任务 (不自动删除)
   */
  permanent: boolean;

  /**
   * 持久化到磁盘
   */
  durable: boolean;

  /**
   * 关联的Agent ID
   */
  agentId?: string;

  /**
   * 任务类型: prompt, skill, agent
   */
  taskType: string;

  /**
   * 额外元数据 (JSON)
   */
  metadata?: Record<string, any>;
}

/**
 * 任务执行历史
 */
export interface TaskExecutionHistory {
  /**
   * 历史记录ID
   */
  id?: number;

  /**
   * 任务ID
   */
  taskId: string;

  /**
   * 触发时间
   */
  firedAt: number;

  /**
   * 完成时间
   */
  completedAt?: number;

  /**
   * 状态
   */
  status: TaskStatus;

  /**
   * 执行结果
   */
  result?: string;

  /**
   * 错误信息
   */
  error?: string;
}

/**
 * 系统配置
 */
export interface SystemConfig {
  /**
   * 配置键
   */
  key: string;

  /**
   * 配置值
   */
  value: string;

  /**
   * 更新时间戳
   */
  updatedAt: number;
}

/**
 * 调度锁
 */
export interface SchedulerLock {
  /**
   * 进程ID
   */
  pid: number;

  /**
   * 身份标识
   */
  identity: string;

  /**
   * 获取时间戳
   */
  acquiredAt: number;
}

/**
 * Cron调度器配置
 */
export interface CronSchedulerOptions {
  /**
   * 任务触发回调
   */
  onFire: (prompt: string) => void;

  /**
   * 加载状态检查
   */
  isLoading: () => boolean;

  /**
   * 助手模式
   */
  assistantMode?: boolean;

  /**
   * 完整任务回调
   */
  onFireTask?: (task: ScheduledTask) => void;

  /**
   * 错过的任务回调
   */
  onMissed?: (tasks: ScheduledTask[]) => void;

  /**
   * 指定工作目录
   */
  dir?: string;

  /**
   * 锁身份标识
   */
  lockIdentity?: string;

  /**
   * Jitter配置获取函数
   */
  getJitterConfig?: () => CronJitterConfig;

  /**
   * 终止开关
   */
  isKilled?: () => boolean;

  /**
   * 任务过滤器
   */
  filter?: (t: ScheduledTask) => boolean;
}

/**
 * Cron抖动配置
 */
export interface CronJitterConfig {
  /**
   * 循环任务抖动 (毫秒)
   */
  recurringJitterMs: number;

  /**
   * 循环任务最大存活时间 (毫秒)
   */
  recurringMaxAgeMs: number;

  /**
   * 一次性任务最大波动 (毫秒)
   */
  oneShotMaxMs: number;

  /**
   * 一次性任务最低波动 (毫秒)
   */
  oneShotFloorMs: number;

  /**
   * 一次性任务分钟取模
   */
  oneShotMinuteMod: number;

  /**
   * 循环任务抖动系数 (0-1)
   */
  recurringFrac: number;

  /**
   * 循环任务最大抖动上限 (毫秒)
   */
  recurringCapMs: number;
}

/**
 * Cron调度器接口
 */
export interface CronScheduler {
  /**
   * 启动调度器
   */
  start(): void;

  /**
   * 停止调度器
   */
  stop(): void;

  /**
   * 获取下次触发时间
   */
  getNextFireTime(): number | null;
}
