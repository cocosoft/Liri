/**
 * SelfWakeTools — Agent 可调用工具注册
 *
 * P0-1: 4 个 Agent Tool 定义
 *   - sleep_for: 挂起 N 秒（≤5min setTimeout 精确，>5min CronScheduler tick）
 *   - sleep_until: 挂起到指定 ISO 时间
 *   - wake_on_job: 等待后台任务完成
 *   - wake_on_event: 等待 connector 事件
 */
import type { SelfWakeService } from './SelfWakeService';
import { cg3Log } from '../cg3Env';

/** sleep_for 工具定义 */
export const SLEEP_FOR_TOOL = {
  name: 'sleep_for' as const,
  description:
    '挂起当前任务，N 秒后恢复。短睡眠（<5 分钟）使用精确的 setTimeout；长睡眠使用 CronScheduler tick。',
  parameters: {
    type: 'object' as const,
    properties: {
      seconds: {
        type: 'number' as const,
        description: '睡眠秒数（最大 86400 = 24 小时）',
      },
    },
    required: ['seconds'],
  },
};

/** sleep_until 工具定义 */
export const SLEEP_UNTIL_TOOL = {
  name: 'sleep_until' as const,
  description: '挂起当前任务，直到指定的 ISO 日期时间。',
  parameters: {
    type: 'object' as const,
    properties: {
      when: {
        type: 'string' as const,
        description: 'ISO 8601 日期时间字符串',
      },
    },
    required: ['when'],
  },
};

/** wake_on_job 工具定义 */
export const WAKE_ON_JOB_TOOL = {
  name: 'wake_on_job' as const,
  description: '暂停当前任务，待指定后台任务完成后恢复。',
  parameters: {
    type: 'object' as const,
    properties: {
      job_id: {
        type: 'string' as const,
        description: '要等待的后台任务 ID',
      },
    },
    required: ['job_id'],
  },
};

/** wake_on_event 工具定义 */
export const WAKE_ON_EVENT_TOOL = {
  name: 'wake_on_event' as const,
  description: '暂停当前任务，待指定连接器事件触发后恢复。',
  parameters: {
    type: 'object' as const,
    properties: {
      event_key: {
        type: 'string' as const,
        description: '连接器事件键',
      },
    },
    required: ['event_key'],
  },
};

/** 所有 SelfWake 工具定义 */
export const SELFWAKE_TOOLS = [
  SLEEP_FOR_TOOL,
  SLEEP_UNTIL_TOOL,
  WAKE_ON_JOB_TOOL,
  WAKE_ON_EVENT_TOOL,
] as const;

/**
 * 创建 SelfWake 工具执行器
 */
export function createSelfWakeToolExecutors(selfWake: SelfWakeService) {
  return {
    async sleep_for(args: {
      seconds: number;
      sessionId: string;
      taskId: string;
    }) {
      const entry = await selfWake.sleepFor(
        args.sessionId,
        args.taskId,
        args.seconds
      );
      return {
        wakeId: entry.id,
        triggerAt: entry.triggerAt,
        status: entry.status,
      };
    },
    async sleep_until(args: {
      when: string;
      sessionId: string;
      taskId: string;
    }) {
      const entry = await selfWake.sleepUntil(
        args.sessionId,
        args.taskId,
        args.when
      );
      return {
        wakeId: entry.id,
        triggerAt: entry.triggerAt,
        status: entry.status,
      };
    },
    async wake_on_job(args: {
      job_id: string;
      sessionId: string;
      taskId: string;
    }) {
      const entry = await selfWake.wakeOnJob(
        args.sessionId,
        args.taskId,
        args.job_id
      );
      return { wakeId: entry.id, status: entry.status };
    },
    async wake_on_event(args: {
      event_key: string;
      sessionId: string;
      taskId: string;
    }) {
      const entry = await selfWake.wakeOnEvent(
        args.sessionId,
        args.taskId,
        args.event_key
      );
      return { wakeId: entry.id, status: entry.status };
    },
  };
}
