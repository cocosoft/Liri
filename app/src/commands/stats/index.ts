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
 * stats命令 - 系统统计信息
 * 对标 CC 源码 commands/stats/stats.tsx
 * 提供 session/tools/tokens 三个维度的统计
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands';
import { getCommandManager } from '@modules/commands';

import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:stats:index',
  level: LogLevel.INFO,
});

/**
 * 统计数据类型
 */
interface StatsData {
  totalCommands: number;
  visibleCommands: number;
  totalAliases: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  nodeVersion: string;
  platform: string;
}

/**
 * 收集系统统计信息
 */
function collectSystemStats(): StatsData {
  const commandManager = getCommandManager();
  const commands = commandManager.getAllCommands();
  const visible = commands.filter((c) => !c.isHidden);
  const aliasCount = commands.reduce(
    (acc, c) => acc + (c.aliases?.length || 0),
    0
  );

  return {
    totalCommands: commands.length,
    visibleCommands: visible.length,
    totalAliases: aliasCount,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
  };
}

/**
 * 处理 session 子命令
 */
function handleSession(): CommandResult {
  const stats = collectSystemStats();
  const memMB = (stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(1);
  const uptimeMin = (stats.uptime / 60).toFixed(1);

  return {
    success: true,
    message: [
      '===== Session Statistics =====',
      `  Node.js:     ${stats.nodeVersion}`,
      `  Platform:    ${stats.platform}`,
      `  Uptime:      ${uptimeMin} min`,
      `  Heap Used:   ${memMB} MB`,
      `  Commands:    ${stats.totalCommands} total, ${stats.visibleCommands} visible`,
      `  Aliases:     ${stats.totalAliases}`,
      '==============================',
    ].join('\n'),
  };
}

/**
 * 处理 tools 子命令
 */
async function handleTools(): Promise<CommandResult> {
  try {
    const toolManager = (
      await import('@modules/tools/ToolManager.js')
    ).getToolManager();
    const tools = toolManager.getAllTools();
    const toolNames = tools.map((t: { name: string }) => t.name).sort();
    const categories = new Map<string, number>();
    for (const t of tools) {
      const prefix = t.name.split(/[A-Z]/)[0] || 'other';
      categories.set(prefix, (categories.get(prefix) || 0) + 1);
    }
    const catLines = Array.from(categories.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `    ${cat}...: ${count} tools`);

    return {
      success: true,
      message: [
        '===== Tools Statistics =====',
        `  Total Tools:  ${toolNames.length}`,
        '',
        '  Categories:',
        ...catLines,
        '',
        '  All Tools:',
        ...toolNames.map((n) => `    - ${n}`),
        '============================',
      ].join('\n'),
    };
  } catch {
    return {
      success: true,
      message: [
        '===== Tools Statistics =====',
        '  ToolManager not available.',
        '============================',
      ].join('\n'),
    };
  }
}

/**
 * 处理 tokens 子命令
 */
async function handleTokens(): Promise<CommandResult> {
  const stats = collectSystemStats();
  const memMB = (stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(1);
  const memTotal = (stats.memoryUsage.heapTotal / 1024 / 1024).toFixed(1);
  const rss = (stats.memoryUsage.rss / 1024 / 1024).toFixed(1);

  let tokenInfo = 'Token usage tracking not available.';
  try {
    const { costTracker } = await import('@modules/cost/CostTracker.js');
    const totalInput = costTracker.getTotalInputTokens();
    const totalOutput = costTracker.getTotalOutputTokens();
    const totalCost = costTracker.getTotalCostUSD();
    tokenInfo = [
      `  Input Tokens:  ${totalInput.toLocaleString()}`,
      `  Output Tokens: ${totalOutput.toLocaleString()}`,
      `  Total Tokens:  ${(totalInput + totalOutput).toLocaleString()}`,
      `  Total Cost:    $${totalCost.toFixed(4)}`,
    ].join('\n');
  } catch (err) {
    // 兜底：costTracker 可能未加载

    handleError(err, {
      module: 'commands:stats:index',
      action: 'costTrackerFallback',
    });
  }

  return {
    success: true,
    message: [
      '===== Token & Resource Statistics =====',
      tokenInfo,
      '',
      '  Memory:',
      `    RSS:         ${rss} MB`,
      `    Heap Used:   ${memMB} MB`,
      `    Heap Total:  ${memTotal} MB`,
      '=======================================',
    ].join('\n'),
  };
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  return {
    success: true,
    message: [
      'Stats 命令帮助',
      '===============',
      '',
      '用法:',
      '  /stats session    查看会话统计（运行时间、命令数量等）',
      '  /stats tools      查看工具统计（工具列表、分类统计）',
      '  /stats tokens     查看 Token 与资源使用统计',
      '  /stats help       显示此帮助',
    ].join('\n'),
  };
}

/**
 * stats命令实现
 */
const stats: Command = {
  type: 'action',
  name: 'stats',
  description: '显示系统统计信息（会话/工具/资源）',
  aliases: ['statistics'],
  argumentHint: '[session|tools|tokens|help]',
  load: () =>
    Promise.resolve({
      execute: async (
        args: string,
        _context: CommandContext
      ): Promise<CommandResult> => {
        const subcommand = args.trim().toLowerCase().split(/\s+/)[0] || '';

        switch (subcommand) {
          case 'session':
            return handleSession();
          case 'tools':
            return await handleTools();
          case 'tokens':
            return await handleTokens();
          case 'help':
          case '--help':
          case '-h':
            return showHelp();
          default:
            return {
              success: true,
              message: [
                'Stats - 系统统计信息',
                '',
                '子命令:',
                '  /stats session    会话统计',
                '  /stats tools      工具统计',
                '  /stats tokens     Token 与资源统计',
                '  /stats help       显示帮助',
                '',
                `提示: 使用 "/stats <子命令>" 查看详情`,
              ].join('\n'),
            };
        }
      },
    }),
};

export default stats;
