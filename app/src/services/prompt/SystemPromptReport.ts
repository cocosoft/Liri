import type { SystemPromptSection } from '@modules/constants/systemPromptSections';
import type { PromptMode } from './types';
import { getCachedTiktokenEncoder } from '../../ai/tokenizer/TiktokenEstimator';
import { estimateTokens } from '../../ai/tokenizer/TokenEstimator';

export interface SectionReportEntry {
  name: string;
  charCount: number;
  estimatedTokens: number;
  cacheBreak: boolean;
  status: 'cached' | 'computed' | 'empty';
  preview: string;
}

export interface SystemPromptReport {
  timestamp: number;
  mode: PromptMode;
  totalSections: number;
  activeSections: number;
  totalChars: number;
  totalEstimatedTokens: number;
  sections: SectionReportEntry[];
  /** 按类别聚合：stable(缓存段) / dynamic(易变段) */
  tokenBreakdown: { stable: number; dynamic: number };
  summary: string;
}

/**
 * P1-14: 使用 tiktoken o200k_base BPE 精确计数，回退 CJK 感知估算
 * 对比原 chars/4 方案：CJK 文本精度提升 3-6x
 */
function estimateTokensPrecise(text: string): number {
  if (!text) return 0;
  const encoder = getCachedTiktokenEncoder();
  if (encoder) {
    try {
      const result = encoder.encode(text);
      return Array.isArray(result) ? result.length : result.length;
    } catch {
      // @ignore-catch: tiktoken encode failure, fallback
    }
  }
  return estimateTokens(text);
}

function truncatePreview(text: string, maxLen: number = 80): string {
  if (!text) return '(empty)';
  const trimmed = text.replace(/\n/g, ' ').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.substring(0, maxLen) + '...';
}

export function generatePromptReport(
  sections: SystemPromptSection[],
  resolvedContent: (string | null)[],
  mode: PromptMode
): SystemPromptReport {
  const entries: SectionReportEntry[] = [];
  let totalChars = 0;
  let stableTokens = 0;
  let dynamicTokens = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const content = resolvedContent[i];
    const charCount = content ? content.length : 0;
    totalChars += charCount;
    const tokens = estimateTokensPrecise(content ?? '');

    let status: 'cached' | 'computed' | 'empty';
    if (content === null || content === undefined) {
      status = 'empty';
    } else if (section.cacheBreak) {
      status = 'computed';
      dynamicTokens += tokens;
    } else {
      status = 'cached';
      stableTokens += tokens;
    }

    entries.push({
      name: section.name,
      charCount,
      estimatedTokens: tokens,
      cacheBreak: section.cacheBreak,
      status,
      preview: content ? truncatePreview(content) : '(empty)',
    });
  }

  const activeCount = entries.filter((e) => e.status !== 'empty').length;
  const totalEstimatedTokens = stableTokens + dynamicTokens;

  return {
    timestamp: Date.now(),
    mode,
    totalSections: sections.length,
    activeSections: activeCount,
    totalChars,
    totalEstimatedTokens,
    sections: entries,
    tokenBreakdown: { stable: stableTokens, dynamic: dynamicTokens },
    summary: `SystemPromptReport: ${activeCount}/${sections.length} sections | ${totalChars} chars | ~${totalEstimatedTokens} tokens (stable=${stableTokens}, dynamic=${dynamicTokens}) | mode=${mode}`,
  };
}

export function formatPromptReport(report: SystemPromptReport): string {
  const lines: string[] = [
    '=== System Prompt Token Wallet ===',
    `Mode: ${report.mode} | Sections: ${report.activeSections}/${report.totalSections} active`,
    `Total: ~${report.totalEstimatedTokens} tokens (${report.totalChars} chars)`,
    `  ▸ Stable (cached):  ~${report.tokenBreakdown.stable} tokens`,
    `  ▸ Dynamic (rebuilt): ~${report.tokenBreakdown.dynamic} tokens`,
    '',
    '--- Section Breakdown ---',
  ];

  // Sort by token count descending
  const sorted = [...report.sections].sort(
    (a, b) => b.estimatedTokens - a.estimatedTokens
  );

  for (const entry of sorted) {
    const icon = entry.status === 'empty' ? '▢' : entry.cacheBreak ? '△' : '○';
    const pct =
      report.totalEstimatedTokens > 0
        ? `${Math.round((entry.estimatedTokens / report.totalEstimatedTokens) * 100)}%`
        : '0%';
    lines.push(
      `  ${icon} ${entry.name.padEnd(20)} ${String(entry.estimatedTokens).padStart(5)} tokens ${pct.padStart(4)} [${entry.status}]`
    );
  }

  // Add cache efficiency note
  if (report.tokenBreakdown.stable + report.tokenBreakdown.dynamic > 0) {
    const cachePct = Math.round(
      (report.tokenBreakdown.stable /
        (report.tokenBreakdown.stable + report.tokenBreakdown.dynamic)) *
        100
    );
    lines.push('');
    lines.push(
      `Cache efficiency: ${cachePct}% (${report.tokenBreakdown.stable} tokens cacheable, ${report.tokenBreakdown.dynamic} tokens must rebuild)`
    );
  }

  lines.push('========================');
  return lines.join('\n');
}
