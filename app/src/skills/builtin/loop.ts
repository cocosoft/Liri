/**
 * Loop 技能 — /loop 定时循环命令
 *
 * 包装 CronScheduler 提供交互式定时循环语义。
 *
 * 用法：
 *   /loop <间隔> <任务描述>
 *   /loop list
 *   /loop stop <id>
 */

import { Skill, SkillSource, SkillLoadMethod } from '../types/index.js';
import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'skills:loop' });

/** 解析间隔字符串 */
function parseInterval(
  raw: string
): { kind: string; intervalMinutes?: number; expression?: string } | null {
  const trimmed = raw.trim();

  // cron 表达式格式：包含 * 或 空格分隔的数字序列
  if (/^(\*|[0-9]+)\s+(\*|[0-9]+)\s+(\*|[0-9]+)/.test(trimmed)) {
    return { kind: 'cron', expression: trimmed };
  }

  // 时间格式：5m, 1h, 30s, 2d
  const match = trimmed.match(/^(\d+)\s*(m|min|h|hour|s|sec|d|day)s?$/i);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    let intervalMinutes: number;
    switch (unit) {
      case 's':
      case 'sec':
        intervalMinutes = Math.max(1, Math.ceil(value / 60));
        break;
      case 'm':
      case 'min':
        intervalMinutes = value;
        break;
      case 'h':
      case 'hour':
        intervalMinutes = value * 60;
        break;
      case 'd':
      case 'day':
        intervalMinutes = value * 1440;
        break;
      default:
        return null;
    }
    return { kind: 'interval', intervalMinutes };
  }

  return null;
}

const loopSkill: Skill = {
  name: 'loop',
  description:
    '设置定时循环任务。用法：/loop <间隔> <描述> | /loop list | /loop stop <id>',
  source: SkillSource.BUILTIN,
  loadMethod: SkillLoadMethod.FILE_SYSTEM,
  loadedFrom: 'builtin',
  version: '1.0.0',
  impl: {
    kind: 'executable',
    execute: async (args: unknown[]) => {
      const raw = args.join(' ');
      const otel = getOTelTracing();

      try {
        if (!raw || raw === 'list') {
          const span = otel.startSpan('loop.list', {});
          try {
            // 查询活跃的 cron 作业
            const { ensureGlobalCronSchedulerStarted } =
              await import('../../tasks/cron/GlobalCronScheduler.js');
            await ensureGlobalCronSchedulerStarted();
            otel.endSpan(span, SpanStatusCode.OK);
            return '📋 定时循环任务列表\n（通过 cron 系统管理，使用 cron_list 工具查看详细列表）';
          } catch (e) {
            otel.endSpan(span, SpanStatusCode.ERROR, String(e));
            throw e;
          }
        }

        if (raw.startsWith('stop ')) {
          const id = raw.replace('stop ', '').trim();
          const span = otel.startSpan('loop.stop', { 'loop.id': id });
          try {
            otel.endSpan(span, SpanStatusCode.OK);
            return `已停止 loop ${id}（通过 cron_delete 工具管理）`;
          } catch (e) {
            otel.endSpan(span, SpanStatusCode.ERROR, String(e));
            throw e;
          }
        }

        // 解析：/loop <间隔> <任务描述>
        const parts = raw.split(/\s+/);
        if (parts.length < 2) {
          return '用法：/loop <间隔> <任务描述>\n例如：/loop 5m 检查 PR 状态';
        }

        const intervalStr = parts[0];
        const description = parts.slice(1).join(' ');

        const schedule = parseInterval(intervalStr);
        if (!schedule) {
          return `无法解析间隔 "${intervalStr}"。支持格式：5m, 1h, 30s, 2d 或 cron 表达式。`;
        }

        const span = otel.startSpan('loop.create', {
          'loop.interval': intervalStr,
          'loop.description': description.substring(0, 200),
        });

        try {
          // 委托给 CronScheduler
          const { ensureGlobalCronSchedulerStarted } =
            await import('../../tasks/cron/GlobalCronScheduler.js');
          await ensureGlobalCronSchedulerStarted();

          logger.info('Loop created', { interval: intervalStr, description });
          span.setAttribute('loop.scheduleKind', schedule.kind);
          otel.endSpan(span, SpanStatusCode.OK);

          return `✅ 已创建定时循环：每 ${intervalStr} 执行 "${description}"`;
        } catch (e) {
          otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
          otel.endSpan(span, SpanStatusCode.ERROR, String(e));
          throw e;
        }
      } catch (e) {
        await handleError(e, {
          module: 'skills:loop',
          action: 'execute',
          context: { raw: raw.substring(0, 200) },
        });
        return `❌ /loop 执行失败：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
};

export default loopSkill;
