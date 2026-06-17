import type { SystemPromptSection } from '@modules/constants/systemPromptSections';
import type { PromptMode } from './types';

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
  summary: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const content = resolvedContent[i];
    const charCount = content ? content.length : 0;
    totalChars += charCount;

    let status: 'cached' | 'computed' | 'empty';
    if (content === null || content === undefined) {
      status = 'empty';
    } else if (section.cacheBreak) {
      status = 'computed';
    } else {
      status = 'cached';
    }

    entries.push({
      name: section.name,
      charCount,
      estimatedTokens: estimateTokens(content ?? ''),
      cacheBreak: section.cacheBreak,
      status,
      preview: content ? truncatePreview(content) : '(empty)',
    });
  }

  const activeCount = entries.filter((e) => e.status !== 'empty').length;
  const totalEstimatedTokens = estimateTokens(
    entries.map((e) => e.charCount).join('')
  );

  return {
    timestamp: Date.now(),
    mode,
    totalSections: sections.length,
    activeSections: activeCount,
    totalChars,
    totalEstimatedTokens,
    sections: entries,
    summary: `SystemPromptReport: ${activeCount}/${sections.length} sections | ${totalChars} chars | ~${totalEstimatedTokens} tokens | mode=${mode}`,
  };
}

export function formatPromptReport(report: SystemPromptReport): string {
  const lines: string[] = [
    '=== SystemPromptReport ===',
    `Mode: ${report.mode}`,
    `Sections: ${report.activeSections}/${report.totalSections} active`,
    `Total chars: ${report.totalChars}`,
    `Estimated tokens: ~${report.totalEstimatedTokens}`,
    '',
    '--- Section Breakdown ---',
  ];

  for (const entry of report.sections) {
    const icon = entry.status === 'empty' ? '▢' : entry.cacheBreak ? '△' : '○';
    lines.push(
      `  ${icon} ${entry.name.padEnd(20)} ${String(entry.charCount).padStart(6)} chars ~${String(entry.estimatedTokens).padStart(5)} tokens [${entry.status}]`
    );
  }

  lines.push('========================');
  return lines.join('\n');
}
