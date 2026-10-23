/**
 * 洞察分析命令实现
 *
 * 2026-10-23：四个子命令改为**真实数据源**（此前全部是硬编码常量，违反 CS04）：
 * - 会话侧：`context.chatManager.getSessionMessages(sessionId)`（与 `/brief` 同源）
 * - 结构化提取：`@modules/analytics` 的 `insightsEngine`（规则化，无 LLM 调用）
 * - 性能侧：`PerformanceMonitorService` 的进程内真实采样（`getAllStats` / 慢操作 / 失败操作）
 *
 * 约束：无数据时**如实说明**，不回填任何常量（CS04）；也不臆造"平均响应时间/评分"这类无法观测的指标。
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { insightsEngine, PerformanceMonitorService } from '@modules/analytics';
import type { InsightsResult } from '@modules/analytics';
// 「慢操作」阈值走常量单一事实源（B 类，`LIRI_INSIGHTS_SLOW_MS` 可覆盖）——
// 原先定义在本文件（`const ... = 1000`）会被 `lint:consts` 判为裸字面量重复事实源。
import { INSIGHTS_SLOW_OPERATION_THRESHOLD_MS } from '@modules/constants';

type Role = 'user' | 'assistant' | 'system' | 'tool';

/** 需要读取会话消息的子命令（`performance` / `help` 不需要） */
const SESSION_SUBCOMMANDS = ['show', 'summary', 'suggestions', 'report'];

/** 会话消息的最小子集：`type` / `role` 两种形态都可能出现（见 Brief.ts 的同款注释） */
interface RawMessage {
  id?: string;
  type?: string;
  role?: string;
  content?: string;
  createdAt?: Date | string;
}

interface SessionInsightData {
  sessionId: string;
  totalMessages: number;
  byRole: Record<Role, number>;
  firstAt?: string;
  lastAt?: string;
  spanMinutes?: number;
  insights: InsightsResult;
}

const ROLE_ALIASES: Record<string, Role> = {
  user: 'user',
  human: 'user',
  assistant: 'assistant',
  ai: 'assistant',
  model: 'assistant',
  tool: 'tool',
  function: 'tool',
  tool_result: 'tool',
  system: 'system',
};

function normalizeRole(message: RawMessage): Role {
  const raw = (message.role ?? message.type ?? '').toLowerCase();
  return ROLE_ALIASES[raw] ?? 'system';
}

function parseDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** 读取并归一化当前会话消息 */
async function loadSessionMessages(
  context: CommandContext
): Promise<
  | { ok: true; sessionId: string; messages: RawMessage[] }
  | { ok: false; message: string }
> {
  if (!context.sessionId) {
    return {
      ok: false,
      message: '错误：当前上下文没有会话 ID，无法读取会话消息。',
    };
  }
  if (!context.chatManager) {
    return { ok: false, message: '错误：聊天管理器不可用，无法读取会话消息。' };
  }

  const sessionId = context.sessionId;
  const chatManager = context.chatManager as {
    getSessionMessages: (sessionId: string) => Promise<unknown[]>;
  };

  try {
    const raw = await chatManager.getSessionMessages(sessionId);
    return { ok: true, sessionId, messages: (raw ?? []) as RawMessage[] };
  } catch (error) {
    return {
      ok: false,
      message: `错误：读取会话消息失败（${error instanceof Error ? error.message : String(error)}）。`,
    };
  }
}

function buildInsightData(
  sessionId: string,
  messages: RawMessage[]
): SessionInsightData {
  const byRole: Record<Role, number> = {
    user: 0,
    assistant: 0,
    system: 0,
    tool: 0,
  };

  for (const message of messages) {
    byRole[normalizeRole(message)] += 1;
  }

  const timestamps = messages
    .map((message) => parseDate(message.createdAt))
    .filter((date): date is Date => date !== undefined)
    .sort((a, b) => a.getTime() - b.getTime());

  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];

  const insights = insightsEngine.extract(
    messages.map((message) => ({
      role: normalizeRole(message),
      content: message.content ?? '',
      timestamp: parseDate(message.createdAt)?.getTime(),
    }))
  );

  return {
    sessionId,
    totalMessages: messages.length,
    byRole,
    firstAt: first?.toISOString(),
    lastAt: last?.toISOString(),
    spanMinutes:
      first && last
        ? Math.round((last.getTime() - first.getTime()) / 60000)
        : undefined,
    insights,
  };
}

function formatShow(data: SessionInsightData): string {
  const lines = [
    `洞察概览（会话 ${data.sessionId}）`,
    `- 消息总数: ${data.totalMessages}`,
    `- 用户 / 助手 / 工具 / 系统: ${data.byRole.user} / ${data.byRole.assistant} / ${data.byRole.tool} / ${data.byRole.system}`,
  ];

  if (data.firstAt && data.lastAt) {
    lines.push(
      `- 时间跨度: ${new Date(data.firstAt).toLocaleString()} ~ ${new Date(data.lastAt).toLocaleString()}（${data.spanMinutes ?? 0} 分钟）`
    );
  } else {
    lines.push('- 时间跨度: 消息缺少可用时间戳，未统计');
  }

  return lines.join('\n');
}

function formatSummary(data: SessionInsightData): string {
  const { insights } = data;
  const sections: string[] = [];

  if (insights.summary) {
    sections.push(`摘要:\n${insights.summary}`);
  }
  if (insights.keyFacts.length > 0) {
    sections.push(
      `关键事实（${insights.keyFacts.length}）:\n${insights.keyFacts
        .map((item) => `- ${item}`)
        .join('\n')}`
    );
  }
  if (insights.decisions.length > 0) {
    sections.push(
      `决策（${insights.decisions.length}）:\n${insights.decisions
        .map((item) => `- ${item}`)
        .join('\n')}`
    );
  }
  if (insights.pendingQuestions.length > 0) {
    sections.push(
      `待处理问题（${insights.pendingQuestions.length}）:\n${insights.pendingQuestions
        .map((item) => `- ${item}`)
        .join('\n')}`
    );
  }
  if (insights.fileChanges.length > 0) {
    sections.push(
      `涉及文件（${insights.fileChanges.length}）:\n${insights.fileChanges
        .map((item) => `- ${item}`)
        .join('\n')}`
    );
  }

  if (sections.length === 0) {
    return '会话摘要\n\n未从当前会话中提取到结构化信息。';
  }

  return `会话摘要\n\n${sections.join('\n\n')}`;
}

interface Suggestion {
  type: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
}

/** 建议只由真实提取结果派生，不引入任何常量指标 */
function deriveSuggestions(data: SessionInsightData): Suggestion[] {
  const { insights } = data;
  const suggestions: Suggestion[] = [];

  if (insights.pendingQuestions.length > 0) {
    suggestions.push({
      type: 'follow-up',
      message: `会话中有 ${insights.pendingQuestions.length} 个待决问题，建议先收敛再追加新任务`,
      priority: insights.pendingQuestions.length >= 3 ? 'high' : 'medium',
    });
  }

  if (insights.fileChanges.length > 0) {
    suggestions.push({
      type: 'review',
      message: `会话涉及 ${insights.fileChanges.length} 处文件变更，建议逐项复核`,
      priority: 'medium',
    });
  }

  if (insights.decisions.length === 0) {
    suggestions.push({
      type: 'alignment',
      message: '会话中未提取到明确决策，建议用「决定：…」句式固化结论',
      priority: 'low',
    });
  }

  if (insights.keyFacts.length === 0) {
    suggestions.push({
      type: 'context',
      message: '未提取到结构化关键事实，建议补充结论性表述',
      priority: 'low',
    });
  }

  return suggestions;
}

function formatSuggestions(suggestions: Suggestion[]): string {
  if (suggestions.length === 0) {
    return '智能建议\n\n当前会话未提取到可执行建议。';
  }

  const rows = suggestions
    .map(
      (item) =>
        `[${item.priority.toUpperCase()}] ${item.type.padEnd(10)} - ${item.message}`
    )
    .join('\n');

  return `智能建议（基于当前会话提取结果）:\n\n${rows}`;
}

interface PerformanceSnapshot {
  operationTypes: number;
  totalCalls: number;
  failedCalls: number;
  slowCalls: number;
  top: Array<{
    operationName: string;
    totalCalls: number;
    avgDuration: number;
    p95Duration: number;
    failedCalls: number;
  }>;
}

function readPerformanceSnapshot(): PerformanceSnapshot {
  const monitor = PerformanceMonitorService.getInstance();
  const stats = monitor.getAllStats();
  const slowCalls = monitor.getSlowOperations(
    INSIGHTS_SLOW_OPERATION_THRESHOLD_MS
  ).length;

  const top = [...stats]
    .sort((a, b) => b.p95Duration - a.p95Duration)
    .slice(0, 5)
    .map((item) => ({
      operationName: item.operationName,
      totalCalls: item.totalCalls,
      avgDuration: Math.round(item.avgDuration),
      p95Duration: Math.round(item.p95Duration),
      failedCalls: item.failedCalls,
    }));

  return {
    operationTypes: stats.length,
    totalCalls: stats.reduce((sum, item) => sum + item.totalCalls, 0),
    failedCalls: stats.reduce((sum, item) => sum + item.failedCalls, 0),
    slowCalls,
    top,
  };
}

function formatPerformance(snapshot: PerformanceSnapshot): string {
  if (snapshot.operationTypes === 0 && snapshot.slowCalls === 0) {
    return '性能洞察\n\n暂无性能采样数据（本进程尚未对任何操作计时）。';
  }

  const lines = [
    '性能洞察（进程内真实采样）',
    `- 已计时操作类型: ${snapshot.operationTypes}`,
    `- 采样总次数: ${snapshot.totalCalls}`,
    `- 失败次数: ${snapshot.failedCalls}`,
    `- 慢操作（> ${INSIGHTS_SLOW_OPERATION_THRESHOLD_MS}ms）: ${snapshot.slowCalls}`,
  ];

  if (snapshot.top.length > 0) {
    lines.push('', '耗时 Top（按 p95 降序）:');
    for (const item of snapshot.top) {
      lines.push(
        `- ${item.operationName}: calls=${item.totalCalls} avg=${item.avgDuration}ms p95=${item.p95Duration}ms fail=${item.failedCalls}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * 结构化洞察载荷（2026-10-23，GUI 面板直接消费；`data` 由 HTTP 层透出）
 *
 * 与 `SessionInsightData` 的差别：把 `insights` 摊平到顶层并带上派生建议，
 * 前端不需要理解内部结构，也无需二次调用 `/insights suggestions`。
 */
export interface InsightReport {
  sessionId: string;
  stats: {
    totalMessages: number;
    byRole: Record<Role, number>;
    firstAt?: string;
    lastAt?: string;
    spanMinutes?: number;
  };
  summary: string;
  keyFacts: string[];
  decisions: string[];
  pendingQuestions: string[];
  fileChanges: string[];
  suggestions: Suggestion[];
  extractedAt: number;
}

function buildReport(data: SessionInsightData): InsightReport {
  return {
    sessionId: data.sessionId,
    stats: {
      totalMessages: data.totalMessages,
      byRole: data.byRole,
      firstAt: data.firstAt,
      lastAt: data.lastAt,
      spanMinutes: data.spanMinutes,
    },
    summary: data.insights.summary,
    keyFacts: data.insights.keyFacts,
    decisions: data.insights.decisions,
    pendingQuestions: data.insights.pendingQuestions,
    fileChanges: data.insights.fileChanges,
    suggestions: deriveSuggestions(data),
    extractedAt: data.insights.extractedAt,
  };
}

/** 空会话的结构化载荷（GUI 据此显示"暂无消息"，而不是空白面板） */
function buildEmptyReport(sessionId: string): InsightReport {
  return {
    sessionId,
    stats: {
      totalMessages: 0,
      byRole: { user: 0, assistant: 0, system: 0, tool: 0 },
    },
    summary: '',
    keyFacts: [],
    decisions: [],
    pendingQuestions: [],
    fileChanges: [],
    suggestions: [],
    extractedAt: Date.now(),
  };
}

function formatReport(report: InsightReport): string {
  const { stats } = report;
  const lines = [
    `会话洞察（会话 ${report.sessionId}）`,
    `- 消息总数: ${stats.totalMessages}`,
    `- 用户 / 助手 / 工具 / 系统: ${stats.byRole.user} / ${stats.byRole.assistant} / ${stats.byRole.tool} / ${stats.byRole.system}`,
  ];

  if (stats.firstAt && stats.lastAt) {
    lines.push(
      `- 时间跨度: ${new Date(stats.firstAt).toLocaleString()} ~ ${new Date(stats.lastAt).toLocaleString()}（${stats.spanMinutes ?? 0} 分钟）`
    );
  }

  if (stats.totalMessages === 0) {
    lines.push('', '当前会话暂无消息。');
    return lines.join('\n');
  }

  if (report.summary) {
    lines.push('', `摘要:\n${report.summary}`);
  }

  const pushSection = (title: string, items: string[]): void => {
    if (items.length === 0) return;
    lines.push('', `${title}（${items.length}）:`);
    for (const item of items) lines.push(`- ${item}`);
  };

  pushSection('关键事实', report.keyFacts);
  pushSection('决策', report.decisions);
  pushSection('待决问题', report.pendingQuestions);
  pushSection('涉及文件', report.fileChanges);

  if (report.suggestions.length > 0) {
    lines.push('', `建议（${report.suggestions.length}）:`);
    for (const item of report.suggestions) {
      lines.push(`- [${item.priority.toUpperCase()}] ${item.message}`);
    }
  }

  return lines.join('\n');
}

function helpText(): string {
  return `洞察分析命令用法:

/insights report       - 一次性输出结构化洞察（统计 / 摘要 / 决策 / 待决问题 / 涉及文件 / 建议）
/insights show         - 显示当前会话的统计概览
/insights summary      - 提取当前会话的摘要 / 决策 / 待处理问题 / 文件变更
/insights suggestions  - 基于当前会话提取结果给出建议
/insights performance  - 显示进程内性能采样（真实数据）
/insights help         - 显示此帮助信息

说明: 本命令不调用模型，全部由规则化提取与进程内采样得出；无数据时如实提示。`;
}

export default {
  /**
   * 执行洞察分析命令
   * @param args 子命令参数
   * @param context 命令上下文
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const subcommand = (args.trim().split(/\s+/)[0] || 'show').toLowerCase();

    if (subcommand === 'help') {
      return { success: true, type: 'text', message: helpText() };
    }

    if (subcommand === 'performance') {
      const snapshot = readPerformanceSnapshot();
      return {
        success: true,
        type: 'text',
        message: formatPerformance(snapshot),
        data: snapshot,
      };
    }

    const loaded = await loadSessionMessages(context);
    if (!loaded.ok) {
      return { success: false, type: 'text', message: loaded.message };
    }

    if (loaded.messages.length === 0) {
      if (!SESSION_SUBCOMMANDS.includes(subcommand)) {
        return { success: false, type: 'text', message: helpText() };
      }
      if (subcommand === 'report') {
        const report = buildEmptyReport(loaded.sessionId);
        return {
          success: true,
          type: 'text',
          message: formatReport(report),
          data: report,
        };
      }
      return {
        success: true,
        type: 'text',
        message: `当前会话（${loaded.sessionId}）暂无消息。`,
      };
    }

    const data = buildInsightData(loaded.sessionId, loaded.messages);

    switch (subcommand) {
      case 'report': {
        const report = buildReport(data);
        return {
          success: true,
          type: 'text',
          message: formatReport(report),
          data: report,
        };
      }
      case 'show':
        return {
          success: true,
          type: 'text',
          message: formatShow(data),
          data,
        };
      case 'summary':
        return {
          success: true,
          type: 'text',
          message: formatSummary(data),
          data,
        };
      case 'suggestions':
        return {
          success: true,
          type: 'text',
          message: formatSuggestions(deriveSuggestions(data)),
          data,
        };
      default:
        return { success: false, type: 'text', message: helpText() };
    }
  },
};
