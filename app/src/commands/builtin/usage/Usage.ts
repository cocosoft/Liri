/**
 * Usage 命令实现
 * 显示基于真实数据的用量统计和趋势分析
 *
 * 对标 CC 源码 cc_code/backend/commands/usage/usage.tsx
 * CC 中以 Settings React 组件展示用量面板，Liri 使用 CLI 文本输出。
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { getCommandManager as getCmdMgr } from '@modules/commands';

/**
 * 使用情况统计命令
 */
const usageCommand = {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const trimmed = args.trim().toLowerCase();

    try {
      if (trimmed === 'help') {
        return handleHelp();
      }

      if (trimmed === 'status') {
        return handleStatus();
      }

      if (trimmed === '--json') {
        return handleJson();
      }

      const params = parseArgs(args);

      if (params.showTrends) {
        return handleTrendsAnalysis();
      } else if (params.showCommands) {
        return handleCommandUsage();
      } else if (params.showTools) {
        return handleToolUsage();
      } else if (params.showBehavior) {
        return handleUserBehavior();
      } else if (params.showPerformance) {
        return handlePerformanceMetrics();
      } else {
        return handleOverallUsage();
      }
    } catch (error) {
      return {
        success: false,
        message: `获取使用统计失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

/**
 * 解析命令行参数
 */
function parseArgs(args: string): {
  showTrends: boolean;
  showCommands: boolean;
  showTools: boolean;
  showBehavior: boolean;
  showPerformance: boolean;
} {
  const trendsRegex = /(^|\s)(--trends|-t)(\s|$)/;
  const commandsRegex = /(^|\s)(--commands|-c)(\s|$)/;
  const toolsRegex = /(^|\s)(--tools|-o)(\s|$)/;
  const behaviorRegex = /(^|\s)(--behavior|-b)(\s|$)/;
  const performanceRegex = /(^|\s)(--performance|-p)(\s|$)/;

  return {
    showTrends: trendsRegex.test(args),
    showCommands: commandsRegex.test(args),
    showTools: toolsRegex.test(args),
    showBehavior: behaviorRegex.test(args),
    showPerformance: performanceRegex.test(args),
  };
}

/**
 * 格式化持续时间
 */
function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分钟`);
  if (parts.length === 0) parts.push('不到1分钟');
  return parts.join(' ');
}

/**
 * 格式化为 KB
 */
function toKB(n: number): string {
  return (n / 1000).toFixed(1) + 'k';
}

/**
 * 显示帮助信息
 */
async function handleHelp(): Promise<CommandResult> {
  return {
    success: true,
    message: [
      '用量统计命令用法:',
      '',
      '/usage                    - 显示总体用量统计',
      '/usage --trends (-t)     - 显示使用趋势分析',
      '/usage --commands (-c)   - 显示命令使用统计',
      '/usage --tools (-o)      - 显示工具使用统计',
      '/usage --behavior (-b)   - 显示用户行为分析',
      '/usage --performance (-p)- 显示性能指标',
      '/usage status            - 显示快速用量状态',
      '/usage --json            - 以 JSON 格式输出',
      '/usage help              - 显示此帮助信息',
      '',
      '总体统计包含:',
      '  - 总 Token 用量（输入/输出/缓存）',
      '  - API 调用与工具调用次数',
      '  - 总成本与会话时长',
      '  - 注册命令数与会话数',
      '',
      '示例:',
      '  /usage',
      '  /usage --commands',
      '  /usage --tools',
      '  /usage status',
      '  /usage --json',
      '',
      '别名: /statistics, /usage-stats',
    ].join('\n'),
  };
}

/**
 * 处理快速用量状态
 */
async function handleStatus(): Promise<CommandResult> {
  const usageStats = getUsageStats();
  const cmdMgr = getCmdMgr();

  return {
    success: true,
    message: [
      '用量状态概览:',
      '',
      `  总 Token: ${usageStats.totalTokens.toLocaleString()} (输入 ${usageStats.inputTokens.toLocaleString()}, 输出 ${usageStats.outputTokens.toLocaleString()})`,
      `  API 调用: ${usageStats.apiCalls} 次`,
      `  工具调用: ${usageStats.toolCalls} 次`,
      `  总成本: $${usageStats.totalCostUSD.toFixed(4)}`,
      `  命令数: ${cmdMgr.getCommandCount()} 个`,
    ].join('\n'),
  };
}

/**
 * 获取 UsageTracker 数据
 */
function getUsageStats() {
  try {
    const {
      getUsageStats: fetchStats,
    } = require('../../../commands/builtin/usage/UsageTracker.js');
    return fetchStats();
  } catch {
    return {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      totalCostUSD: 0,
      apiCalls: 0,
      toolCalls: 0,
      sessionDurationMs: 0,
    };
  }
}

/**
 * 处理总体用量统计
 */
async function handleOverallUsage(): Promise<CommandResult> {
  const usageStats = getUsageStats();
  const cmdMgr = getCmdMgr();
  const uptime = process.uptime();

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_usage_overview',
    {
      totalTokens: usageStats.totalTokens,
      apiCalls: usageStats.apiCalls,
      toolCalls: usageStats.toolCalls,
      totalCost: usageStats.totalCostUSD,
    }
  );

  const lines: string[] = [];
  lines.push('📊 总体用量统计');
  lines.push('');
  lines.push('🪙 Token 用量');
  lines.push(`   总 Token: ${usageStats.totalTokens.toLocaleString()}`);
  lines.push(
    `   输入 Token: ${usageStats.inputTokens.toLocaleString()} (${toKB(usageStats.inputTokens)})`
  );
  lines.push(
    `   输出 Token: ${usageStats.outputTokens.toLocaleString()} (${toKB(usageStats.outputTokens)})`
  );
  lines.push(
    `   缓存读取: ${usageStats.cacheReadTokens.toLocaleString()} (${toKB(usageStats.cacheReadTokens)})`
  );
  lines.push('');
  lines.push('📞 调用统计');
  lines.push(`   API 调用: ${usageStats.apiCalls} 次`);
  lines.push(`   工具调用: ${usageStats.toolCalls} 次`);
  lines.push('');
  lines.push('💰 成本');
  lines.push(`   总成本: $${usageStats.totalCostUSD.toFixed(4)}`);
  lines.push(`   运行时间: ${formatDuration(uptime)}`);
  lines.push('');
  lines.push('📋 系统');
  lines.push(`   已注册命令: ${cmdMgr.getCommandCount()} 个`);

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理趋势分析
 */
async function handleTrendsAnalysis(): Promise<CommandResult> {
  const usageStats = getUsageStats();
  const uptime = process.uptime();

  const lines: string[] = [];
  lines.push('📈 使用趋势分析');
  lines.push('');
  lines.push('当前会话趋势:');
  lines.push(`   运行时长: ${formatDuration(uptime)}`);
  lines.push(
    `   API 调用率: ${(usageStats.apiCalls / (uptime / 3600)).toFixed(1)} 次/小时`
  );
  lines.push(
    `   工具调用率: ${(usageStats.toolCalls / (uptime / 3600)).toFixed(1)} 次/小时`
  );
  lines.push(
    `   Token 速率: ${(usageStats.totalTokens / (uptime / 60)).toFixed(0)} token/分钟`
  );
  lines.push('');
  lines.push('缓存命中:');
  lines.push(`   缓存读取: ${toKB(usageStats.cacheReadTokens)}`);
  lines.push(`   缓存创建: ${toKB(usageStats.cacheCreateTokens)}`);
  if (usageStats.cacheReadTokens + usageStats.cacheCreateTokens > 0) {
    const hitRate =
      (usageStats.cacheReadTokens /
        (usageStats.cacheReadTokens + usageStats.cacheCreateTokens)) *
      100;
    lines.push(`   缓存命中率: ${hitRate.toFixed(1)}%`);
  }

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理命令使用统计
 */
async function handleCommandUsage(): Promise<CommandResult> {
  const cmdMgr = getCmdMgr();
  const cmdCount = cmdMgr.getCommandCount();

  const lines: string[] = [];
  lines.push('📋 命令使用统计');
  lines.push('');
  lines.push(`已注册命令数: ${cmdCount} 个`);
  lines.push('');
  lines.push('可用命令分类:');
  lines.push('  - 系统命令: /help, /activity, /usage, /cost');
  lines.push('  - 编辑命令: /vim, /write, /edit');
  lines.push('  - 安全命令: /security, /permissions');
  lines.push('  - 模型命令: /model, /version');
  lines.push('  - 工具命令: /export, /share, /voice');
  lines.push('  - 管理命令: /memory, /hooks, /plugins, /mcp');

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理工具使用统计
 */
async function handleToolUsage(): Promise<CommandResult> {
  const usageStats = getUsageStats();

  const lines: string[] = [];
  lines.push('🔧 工具使用统计');
  lines.push('');
  lines.push(`工具调用次数: ${usageStats.toolCalls} 次`);
  lines.push('');
  lines.push('工具类型:');
  lines.push('  - 文件操作 (Read, Write, Edit, Glob)');
  lines.push('  - 系统命令 (Bash, Grep)');
  lines.push('  - 搜索工具 (SearchCodebase)');
  lines.push('  - 网络工具 (WebFetch, WebSearch)');
  lines.push('  - MCP 工具 (通过 MCP 协议加载)');

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理用户行为分析
 */
async function handleUserBehavior(): Promise<CommandResult> {
  const usageStats = getUsageStats();
  const uptime = process.uptime();
  const avgTokensPerCall =
    usageStats.apiCalls > 0
      ? Math.round(usageStats.totalTokens / usageStats.apiCalls)
      : 0;

  const lines: string[] = [];
  lines.push('👤 用户行为分析');
  lines.push('');
  lines.push('使用模式:');
  lines.push(
    `   平均每次 API 调用 Token: ${avgTokensPerCall.toLocaleString()}`
  );
  lines.push(
    `   工具/API 比率: ${usageStats.toolCalls}:${usageStats.apiCalls}`
  );
  lines.push(`   会话时长: ${formatDuration(uptime)}`);
  lines.push('');
  lines.push('成本效率:');
  lines.push(
    `   每小时成本: $${(usageStats.totalCostUSD / (uptime / 3600)).toFixed(4)}`
  );
  lines.push(
    `   每次 API 成本: $${(usageStats.totalCostUSD / (usageStats.apiCalls || 1)).toFixed(6)}`
  );

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理性能指标
 */
async function handlePerformanceMetrics(): Promise<CommandResult> {
  const usageStats = getUsageStats();
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();

  const lines: string[] = [];
  lines.push('⚡ 性能指标');
  lines.push('');
  lines.push('系统:');
  lines.push(`   运行时间: ${formatDuration(uptime)}`);
  lines.push(`   进程 PID: ${process.pid}`);
  lines.push(`   平台: ${process.platform} ${process.arch}`);
  lines.push('');
  lines.push('资源使用:');
  lines.push(
    `   堆内存: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`
  );
  lines.push(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`);
  lines.push('');
  lines.push('API 性能:');
  lines.push(`   API 调用: ${usageStats.apiCalls} 次`);
  lines.push(
    `   调用频率: ${(usageStats.apiCalls / (uptime / 3600)).toFixed(1)} 次/小时`
  );

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理 JSON 格式输出
 */
async function handleJson(): Promise<CommandResult> {
  const usageStats = getUsageStats();
  const uptime = process.uptime();
  const cmdMgr = getCmdMgr();
  const memUsage = process.memoryUsage();

  const data = {
    app: 'Liri',
    tokens: {
      total: usageStats.totalTokens,
      input: usageStats.inputTokens,
      output: usageStats.outputTokens,
      cacheRead: usageStats.cacheReadTokens,
      cacheCreate: usageStats.cacheCreateTokens,
    },
    calls: {
      api: usageStats.apiCalls,
      tools: usageStats.toolCalls,
    },
    cost: Math.round(usageStats.totalCostUSD * 10000) / 10000,
    session: {
      durationMs: usageStats.sessionDurationMs,
      uptime: Math.floor(uptime),
    },
    system: {
      commands: cmdMgr.getCommandCount(),
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      memoryMB: Math.round(memUsage.rss / 1024 / 1024),
    },
  };

  return {
    success: true,
    message: JSON.stringify(data, null, 2),
  };
}

export default usageCommand;
