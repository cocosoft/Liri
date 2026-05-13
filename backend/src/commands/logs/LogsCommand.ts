/**
 * 日志查询命令
 * 按时间/级别/模块/链路 ID 过滤查询日志
 * 对齐 OpenClaw logs CLI
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { StructuredLogger } from '@modules/monitoring/logs/StructuredLogger';

const logger = new Logger({ level: LogLevel.INFO });

const logsCmd: Command = {
  type: 'local',
  name: 'logs',
  description: 'Query structured logs by level, module, time, or trace',
  aliases: ['log'],
  loadedFrom: 'builtin',
  disableModelInvocation: true,
  userInvocable: true,
  argumentHint: '[--level info] [--module name] [--trace id] [--since 5m] [--limit 50]',

  async load() {
    return {
      async execute(args: string, _ctx?: CommandContext): Promise<CommandResult> {
        try {
          const filter = parseFilter(args);
          const entries = StructuredLogger.queryLogs(filter);
          return {
            success: true,
            type: 'text',
            message: formatLogOutput(entries),
            data: entries,
          };
        } catch (error) {
          logger.error('日志查询失败', error as Error);
          return { success: false, type: 'error', error: `日志查询失败: ${(error as Error).message}` };
        }
      },
    };
  },
};

function parseFilter(raw: string): Record<string, unknown> {
  const filter: Record<string, unknown> = { limit: 50 };
  const parts = raw.match(/--(\w+)\s+([^\s]+)/gi);
  if (!parts) return filter;
  for (const part of parts) {
    const m = part.match(/--(\w+)\s+(.+)/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];
    switch (key) {
      case 'level':
        filter['level'] = val;
        break;
      case 'module':
        filter['module'] = val;
        break;
      case 'trace':
      case 'trace_id':
        filter['traceId'] = val;
        break;
      case 'since': {
        const num = parseInt(val, 10);
        if (val.endsWith('h') || val.endsWith('H')) filter['sinceMs'] = num * 3600000;
        else if (val.endsWith('m') || val.endsWith('M')) filter['sinceMs'] = num * 60000;
        else if (val.endsWith('s') || val.endsWith('S')) filter['sinceMs'] = num * 1000;
        else filter['sinceMs'] = num * 60000;
        break;
      }
      case 'limit':
        filter['limit'] = parseInt(val, 10) || 50;
        break;
    }
  }
  return filter;
}

function formatLogOutput(entries: Array<{
  timestamp: string;
  level: string;
  module: string;
  message: string;
  traceId?: string;
  error?: { name: string; message: string };
}>): string {
  if (entries.length === 0) return '无匹配日志';
  return entries
    .map((e) => {
      const time = e.timestamp.slice(11, 19);
      const lvl = e.level.toUpperCase().padEnd(7);
      const mod = (e.module || '-').padEnd(20);
      const msg = e.message.slice(0, 100);
      const err = e.error ? ` [${e.error.name}]` : '';
      return `[${time}] ${lvl} ${mod} ${msg}${err}`;
    })
    .join('\n');
}

export default logsCmd;
