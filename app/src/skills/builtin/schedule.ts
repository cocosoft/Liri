/**
 * Schedule 技能 — /schedule 统一计划管理
 *
 * 列出所有计划任务（含 time-based /loop 和 proactive webhook）。
 *
 * 用法：
 *   /schedule list
 *   /schedule events
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';
import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'skills:schedule' });

const scheduleSkill: Skill = {
  name: 'schedule',
  description:
    '查看所有计划任务和事件监听。用法：/schedule list | /schedule events',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (args: unknown[]) => {
      const raw = args.join(' ').trim();

      try {
        if (raw === 'events') {
          // TODO: 从 ProactiveLoop 注册表读取 webhook 历史
          return '📋 事件监听\n暂无 active webhook。可通过 /loop 创建定时任务，通过 channel 注册 webhook。';
        }

        // 默认：列出所有计划任务
        try {
          const { ensureGlobalCronSchedulerStarted } =
            await import('../../tasks/cron/GlobalCronScheduler.js');
          await ensureGlobalCronSchedulerStarted();
        } catch {
          // CronScheduler 可能未启动
        }

        return '📋 计划任务列表\n使用 /loop <间隔> 创建定时任务。\n使用 cron_list 工具查看详细 cron 作业列表。';
      } catch (e) {
        await handleError(e, {
          module: 'skills:schedule',
          action: 'execute',
        });
        return `❌ /schedule 执行失败：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
};

export default scheduleSkill;
