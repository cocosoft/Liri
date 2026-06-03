// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Usage Stats 命令实现
 * 查看模型使用量统计数据
 */

import type { CommandContext, CommandResult } from '@modules/commands/types';
import { usageStatsService } from '@modules/ai/models/UsageStatsService.js';

/** 格式化货币显示 */
function fmtUSD(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/** 格式化 token 数量 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** 获取今天起始和结束时间戳 */
function getTodayRange(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(Date.now() / 1000),
  };
}

/** 获取最近N天范围 */
function getLastNDaysRange(days: number): { start: number; end: number } {
  const now = Date.now();
  return {
    start: Math.floor((now - days * 86400000) / 1000),
    end: Math.floor(now / 1000),
  };
}

const usagestatsCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const trimmed = args.trim();
    const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
    const cleaned = trimmed.replace(/--json\s*/g, '').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const subcommand = parts[0]?.toLowerCase() || 'summary';

    try {
      await usageStatsService.initialize();

      switch (subcommand) {
        case 'help':
          return usageHelp();

        case 'summary': {
          const range = getTodayRange();
          const summary = await usageStatsService.getUsageSummary(
            range.start,
            range.end
          );

          if (showJson) {
            return { success: true, message: JSON.stringify(summary, null, 2) };
          }

          return {
            success: true,
            message: `使用量概览（今日）
────────────────────────
  总请求数:    ${summary.totalRequests.toLocaleString()}
  总成本:      ${fmtUSD(summary.totalCost)}
  输入 Tokens: ${fmtTokens(summary.totalInputTokens)}
  输出 Tokens: ${fmtTokens(summary.totalOutputTokens)}
  缓存读:      ${fmtTokens(summary.totalCacheReadTokens)}
  缓存写:      ${fmtTokens(summary.totalCacheCreationTokens)}
  成功率:      ${summary.successRate}%`,
          };
        }

        case 'trend': {
          const range = getLastNDaysRange(7);
          const trends = await usageStatsService.getDailyTrends(
            range.start,
            range.end
          );

          if (showJson) {
            return { success: true, message: JSON.stringify(trends, null, 2) };
          }

          if (trends.length === 0) {
            return { success: true, message: '暂无数据' };
          }

          const lines = ['每日趋势（最近7天）', '─'.repeat(60)];
          for (const t of trends) {
            lines.push(
              `  ${t.date} | ${String(t.requestCount).padStart(5)} 请求 | ${fmtUSD(t.totalCost).padStart(10)} | ${fmtTokens(t.totalTokens).padStart(8)} tokens`
            );
          }

          return { success: true, message: lines.join('\n') };
        }

        case 'models': {
          const range = getLastNDaysRange(30);
          const stats = await usageStatsService.getModelStats(
            range.start,
            range.end
          );

          if (showJson) {
            return { success: true, message: JSON.stringify(stats, null, 2) };
          }

          if (stats.length === 0) {
            return { success: true, message: '暂无数据' };
          }

          const lines = ['按模型统计（最近30天）', '─'.repeat(80)];
          lines.push(
            `${'模型'.padEnd(30)} | ${'请求数'.padStart(8)} | ${'Tokens'.padStart(10)} | ${'成本'.padStart(10)} | ${'均延迟'.padStart(8)}`
          );
          lines.push('─'.repeat(80));

          for (const s of stats) {
            lines.push(
              `${(s.model || '').padEnd(30)} | ${String(s.requestCount).padStart(8)} | ${fmtTokens(s.totalTokens).padStart(10)} | ${fmtUSD(s.totalCost).padStart(10)} | ${String(s.avgLatencyMs + 'ms').padStart(8)}`
            );
          }

          return { success: true, message: lines.join('\n') };
        }

        case 'providers': {
          const range = getLastNDaysRange(30);
          const stats = await usageStatsService.getProviderStats(
            range.start,
            range.end
          );

          if (showJson) {
            return { success: true, message: JSON.stringify(stats, null, 2) };
          }

          if (stats.length === 0) {
            return { success: true, message: '暂无数据' };
          }

          const lines = ['按供应商统计（最近30天）', '─'.repeat(80)];
          lines.push(
            `${'供应商'.padEnd(36)} | ${'请求数'.padStart(8)} | ${'Tokens'.padStart(10)} | ${'成本'.padStart(10)} | ${'成功率'.padStart(8)}`
          );
          lines.push('─'.repeat(80));

          for (const s of stats) {
            lines.push(
              `${s.providerId.substring(0, 34).padEnd(36)} | ${String(s.requestCount).padStart(8)} | ${fmtTokens(s.totalTokens).padStart(10)} | ${fmtUSD(s.totalCost).padStart(10)} | ${String(s.successRate + '%').padStart(8)}`
            );
          }

          return { success: true, message: lines.join('\n') };
        }

        case 'logs': {
          const page = parseInt(parts[1]) || 1;
          const pageSize = parseInt(parts[2]) || 20;

          const result = await usageStatsService.getRequestLogs(
            {},
            page,
            pageSize
          );

          if (showJson) {
            return { success: true, message: JSON.stringify(result, null, 2) };
          }

          if (result.data.length === 0) {
            return { success: true, message: '暂无日志' };
          }

          const lines = [
            `请求日志 (第${result.page}页, 共${result.total}条)`,
            '─'.repeat(100),
          ];

          for (const log of result.data) {
            const time = new Date(log.timestamp * 1000).toLocaleString('zh-CN');
            const status =
              log.statusCode >= 400
                ? `❌${log.statusCode}`
                : `✅${log.statusCode}`;
            lines.push(
              `${time} | ${log.model.padEnd(25)} | ${String(log.inputTokens + log.outputTokens).padStart(8)}t | ${fmtUSD(log.costUSD).padStart(8)} | ${status} | ${log.latencyMs}ms`
            );
          }

          return { success: true, message: lines.join('\n') };
        }

        default:
          return {
            success: false,
            message: `未知子命令: ${subcommand}\n使用 /usagestats help 查看帮助。`,
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `查询失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

function usageHelp(): CommandResult {
  return {
    success: true,
    message: `Usage Stats 命令 — 模型使用量统计
====================================

用法:
  /usagestats summary        查看今日概览
  /usagestats trend          查看最近7天每日趋势
  /usagestats models         按模型统计（最近30天）
  /usagestats providers      按供应商统计（最近30天）
  /usagestats logs [page]    查看请求日志
  /usagestats help           显示此帮助

所有子命令均可加 --json 输出 JSON 格式。

别名: /usagelog, /stats-usage`,
  };
}

export default usagestatsCommand;
