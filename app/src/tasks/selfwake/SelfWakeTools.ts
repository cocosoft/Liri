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
    'Suspend the current task and resume after N seconds. Short sleeps (<5min) use precise setTimeout; long sleeps use CronScheduler tick.',
  parameters: {
    type: 'object' as const,
    properties: {
      seconds: {
        type: 'number' as const,
        description: 'Seconds to sleep (max 86400 = 24h)',
      },
    },
    required: ['seconds'],
  },
};

/** sleep_until 工具定义 */
export const SLEEP_UNTIL_TOOL = {
  name: 'sleep_until' as const,
  description: 'Suspend the current task until a specific ISO datetime.',
  parameters: {
    type: 'object' as const,
    properties: {
      when: {
        type: 'string' as const,
        description: 'ISO 8601 datetime string',
      },
    },
    required: ['when'],
  },
};

/** wake_on_job 工具定义 */
export const WAKE_ON_JOB_TOOL = {
  name: 'wake_on_job' as const,
  description:
    'Pause the current task and resume when a specific background job completes.',
  parameters: {
    type: 'object' as const,
    properties: {
      job_id: {
        type: 'string' as const,
        description: 'Background job ID to wait for',
      },
    },
    required: ['job_id'],
  },
};

/** wake_on_event 工具定义 */
export const WAKE_ON_EVENT_TOOL = {
  name: 'wake_on_event' as const,
  description:
    'Pause the current task and resume when a specific connector event fires.',
  parameters: {
    type: 'object' as const,
    properties: {
      event_key: {
        type: 'string' as const,
        description: 'Connector event key',
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
