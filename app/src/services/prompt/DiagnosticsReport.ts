/**
 * DiagnosticsReport — 增强诊断报告（P3-11）
 *
 * 按静态/动态/技能/tools 分类的 Token 消耗分解。
 * 对标 cc_code context_breakdown — 8类分解 + 建议生成。
 */
import { getCachedTiktokenEncoder } from '@modules/ai';

export interface CategoryBreakdown {
  category: string;
  tokens: number;
  percentage: number;
  items: Array<{ name: string; tokens: number }>;
}

export interface DiagnosticsReport {
  totalTokens: number;
  contextLimit: number;
  usagePercent: number;
  breakdown: CategoryBreakdown[];
  suggestions: string[];
}

// B（Liri 复查收尾）：删除历史 CATEGORIES 手工名单（identity/toolUse/skills… 曾在此维护，
// 实际从未被消费——static/dynamic 分类由 generateDiagnosticsReport 按 section.cacheBreak
// 运行时推导，见下）。skills 已改 user message 注入，本就不在 system sections 输入中，
// 报告不含 skills 归属。保留 CATEGORIES 死名单会造成"第三份手工名单"漂移（Liri 盲点 1）。

function countTokens(text: string): number {
  if (!text) return 0;
  const encoder = getCachedTiktokenEncoder();
  if (encoder) {
    try {
      const r = encoder.encode(text);
      return r.length;
    } catch {
      /* fallback */
    }
  }
  return Math.ceil(text.length / 4);
}

export function generateDiagnosticsReport(
  sections: Array<{ name: string; content: string; cacheBreak: boolean }>,
  messagesTokenCount: number,
  toolDefsTokenCount: number,
  toolResultsTokenCount: number,
  memoryFilesTokenCount: number,
  mcpInstructionsTokenCount: number,
  contextLimit: number
): DiagnosticsReport {
  const breakdown: CategoryBreakdown[] = [];
  let total = 0;

  // System Prompt sections
  let staticTokens = 0,
    dynamicTokens = 0;
  const staticItems: Array<{ name: string; tokens: number }> = [];
  const dynamicItems: Array<{ name: string; tokens: number }> = [];

  for (const s of sections) {
    const tokens = countTokens(s.content);
    if (s.cacheBreak) {
      dynamicTokens += tokens;
      dynamicItems.push({ name: s.name, tokens });
    } else {
      staticTokens += tokens;
      staticItems.push({ name: s.name, tokens });
    }
  }

  breakdown.push({
    category: 'System Prompt (static)',
    tokens: staticTokens,
    percentage: 0,
    items: staticItems,
  });
  breakdown.push({
    category: 'System Prompt (dynamic)',
    tokens: dynamicTokens,
    percentage: 0,
    items: dynamicItems,
  });
  total += staticTokens + dynamicTokens;

  // Messages
  breakdown.push({
    category: 'Conversation Messages',
    tokens: messagesTokenCount,
    percentage: 0,
    items: [],
  });
  total += messagesTokenCount;

  // Tool defs
  breakdown.push({
    category: 'Tool Definitions',
    tokens: toolDefsTokenCount,
    percentage: 0,
    items: [],
  });
  total += toolDefsTokenCount;

  // Tool results
  breakdown.push({
    category: 'Tool Results',
    tokens: toolResultsTokenCount,
    percentage: 0,
    items: [],
  });
  total += toolResultsTokenCount;

  // Memory
  breakdown.push({
    category: 'Memory Files',
    tokens: memoryFilesTokenCount,
    percentage: 0,
    items: [],
  });
  total += memoryFilesTokenCount;

  // MCP
  breakdown.push({
    category: 'MCP Instructions',
    tokens: mcpInstructionsTokenCount,
    percentage: 0,
    items: [],
  });
  total += mcpInstructionsTokenCount;

  // Recompute percentages
  for (const cat of breakdown) {
    cat.percentage = total > 0 ? Math.round((cat.tokens / total) * 100) : 0;
  }

  // Generate suggestions
  const suggestions: string[] = [];
  const usagePercent = Math.round((total / contextLimit) * 100);
  const toolResultPct =
    breakdown.find((b) => b.category === 'Tool Results')?.percentage ?? 0;
  const dynamicPct =
    breakdown.find((b) => b.category === 'System Prompt (dynamic)')
      ?.percentage ?? 0;
  const memoryPct =
    breakdown.find((b) => b.category === 'Memory Files')?.percentage ?? 0;

  if (usagePercent > 80)
    suggestions.push(
      `⚠ Context usage high (${usagePercent}%). Consider /compact or limit tool results.`
    );
  if (toolResultPct > 15)
    suggestions.push(
      `Tool results consume ${toolResultPct}% — use offset/limit on read_file and truncate large outputs.`
    );
  if (dynamicPct > 20)
    suggestions.push(
      `Dynamic sections consume ${dynamicPct}% — review skills/memory/git context injection.`
    );
  if (memoryPct > 5)
    suggestions.push(
      `Memory files at ${memoryPct}% — trim with /memory prune.`
    );

  return {
    totalTokens: total,
    contextLimit,
    usagePercent,
    breakdown,
    suggestions,
  };
}
