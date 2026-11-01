/**
 * Comment Label
 * 对标CC源码 utils/bash/commentLabel.ts
 * 解析Bash命令中的注释标签，用于标记特殊语义和结构化注解
 */

export type CommentLabelType =
  | 'tool_result'
  | 'tool_error'
  | 'confirmation'
  | 'user_facing'
  | 'warning'
  | 'info'
  | 'sandbox'
  | 'mode_hint'
  | 'permission_hint'
  | 'readonly_hint'
  | 'custom';

export interface CommentLabel {
  type: CommentLabelType;
  label: string;
  value?: string;
  raw: string;
  lineNumber: number;
  confidence: number;
}

export interface CommentLabelPattern {
  type: CommentLabelType;
  patterns: RegExp[];
  priority: number;
}

const LABEL_PATTERNS: CommentLabelPattern[] = [
  {
    type: 'tool_result',
    patterns: [
      /#\s*<<\s*tool_result\s*>>/i,
      /#\s*<<\s*result\s*>>/i,
      /#\s*\[tool_result\]/i,
    ],
    priority: 10,
  },
  {
    type: 'tool_error',
    patterns: [
      /#\s*<<\s*tool_error\s*>>/i,
      /#\s*<<\s*error\s*>>/i,
      /#\s*\[tool_error\]/i,
    ],
    priority: 10,
  },
  {
    type: 'confirmation',
    patterns: [
      /#\s*<<\s*confirmation\s*>>/i,
      /#\s*<<\s*confirm\s*>>/i,
      /#\s*\[confirmation_required\]/i,
      /#\s*\[needs_confirmation\]/i,
    ],
    priority: 8,
  },
  {
    type: 'user_facing',
    patterns: [
      /#\s*<<\s*user_facing\s*>>/i,
      /#\s*<<\s*user\s*>>/i,
      /#\s*\[user_facing\]/i,
    ],
    priority: 7,
  },
  {
    type: 'warning',
    patterns: [/#\s*<<\s*warning\s*>>/i, /#\s*\[warning\]/i, /#\s*WARNING:/i],
    priority: 6,
  },
  {
    type: 'info',
    patterns: [/#\s*<<\s*info\s*>>/i, /#\s*\[info\]/i, /#\s*INFO:/i],
    priority: 5,
  },
  {
    type: 'sandbox',
    patterns: [
      /#\s*<<\s*sandbox\s*>>/i,
      /#\s*\[sandbox\]/i,
      /#\s*\[isolated\]/i,
    ],
    priority: 9,
  },
  {
    type: 'mode_hint',
    patterns: [
      /#\s*<<\s*mode:\s*(\w+)\s*>>/i,
      /#\s*\[mode:\s*(\w+)\]/i,
      /#\s*@mode\s+(\w+)/i,
    ],
    priority: 9,
  },
  {
    type: 'permission_hint',
    patterns: [
      /#\s*<<\s*permission:\s*(\w+)\s*>>/i,
      /#\s*\[permission:\s*(\w+)\]/i,
      /#\s*@permission\s+(\w+)/i,
    ],
    priority: 8,
  },
  {
    type: 'readonly_hint',
    patterns: [
      /#\s*<<\s*readonly\s*>>/i,
      /#\s*\[readonly\]/i,
      /#\s*@readonly/i,
    ],
    priority: 9,
  },
  {
    type: 'custom',
    patterns: [/#\s*<<\s*(\w+)\s*:\s*(.+?)\s*>>/i, /#\s*\[(\w+):\s*(.+?)\]/i],
    priority: 1,
  },
];

export function extractCommentLabels(
  command: string,
  options?: { includeCustom?: boolean }
): CommentLabel[] {
  const labels: CommentLabel[] = [];
  const lines = command.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed.startsWith('#')) {
      continue;
    }

    for (const patternDef of LABEL_PATTERNS) {
      if (patternDef.type === 'custom' && !options?.includeCustom) {
        continue;
      }

      for (const pattern of patternDef.patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const value = match[1] || match[2] || undefined;
          const confidence = patternDef.priority / 10;

          const existing = labels.find(
            (l) => l.type === patternDef.type && l.value === value
          );
          if (existing && existing.confidence >= confidence) {
            continue;
          }

          labels.push({
            type: patternDef.type,
            label: patternDef.type.replace(/_/g, ' '),
            value,
            raw: match[0].trim(),
            lineNumber: i + 1,
            confidence,
          });
        }
      }
    }
  }

  return labels.sort((a, b) => b.confidence - a.confidence);
}

export function hasCommentLabel(
  command: string,
  type: CommentLabelType
): boolean {
  const labels = extractCommentLabels(command);
  return labels.some((l) => l.type === type);
}

export function getLabelValue(
  command: string,
  type: CommentLabelType
): string | undefined {
  const labels = extractCommentLabels(command);
  const match = labels.find((l) => l.type === type);
  return match?.value;
}

export function stripCommentLabels(command: string): string {
  const labels = extractCommentLabels(command, { includeCustom: true });
  if (labels.length === 0) {
    return command;
  }

  let result = command;
  const sortedLabels = [...labels].sort((a, b) => b.lineNumber - a.lineNumber);

  for (const label of sortedLabels) {
    const lines = result.split('\n');
    const lineIdx = label.lineNumber - 1;

    if (lineIdx < 0 || lineIdx >= lines.length) {
      continue;
    }

    const line = lines[lineIdx];
    const stripped = line.replace(label.raw, '').trim();

    if (stripped === '' || stripped === '#') {
      lines.splice(lineIdx, 1);
    } else {
      lines[lineIdx] = stripped;
    }

    result = lines.join('\n');
  }

  return result;
}

export function classifyCommandByLabels(command: string): {
  category: string;
  confidence: number;
  labels: CommentLabel[];
} {
  const labels = extractCommentLabels(command, { includeCustom: true });

  if (labels.length === 0) {
    return { category: 'unlabeled', confidence: 1.0, labels: [] };
  }

  const topLabel = labels[0];

  const categoryMap: Record<CommentLabelType, string> = {
    tool_result: 'tool_output',
    tool_error: 'tool_error',
    confirmation: 'needs_confirmation',
    user_facing: 'user_output',
    warning: 'warning',
    info: 'info',
    sandbox: 'sandboxed',
    mode_hint: 'mode_aware',
    permission_hint: 'permission_aware',
    readonly_hint: 'readonly_aware',
    custom: 'custom',
  };

  return {
    category: categoryMap[topLabel.type] || 'unknown',
    confidence: topLabel.confidence,
    labels,
  };
}

export function addCommentLabel(
  command: string,
  type: CommentLabelType,
  value?: string
): string {
  let labelStr: string;

  switch (type) {
    case 'tool_result':
      labelStr = '# <<tool_result>>';
      break;
    case 'tool_error':
      labelStr = '# <<tool_error>>';
      break;
    case 'confirmation':
      labelStr = '# <<confirmation>>';
      break;
    case 'user_facing':
      labelStr = '# <<user_facing>>';
      break;
    case 'warning':
      labelStr = '# <<warning>>';
      break;
    case 'info':
      labelStr = '# <<info>>';
      break;
    case 'sandbox':
      labelStr = '# <<sandbox>>';
      break;
    case 'mode_hint':
      labelStr = value ? `# <<mode:${value}>>` : '# <<mode>>';
      break;
    case 'permission_hint':
      labelStr = value ? `# <<permission:${value}>>` : '# <<permission>>';
      break;
    case 'readonly_hint':
      labelStr = '# <<readonly>>';
      break;
    case 'custom':
      labelStr = value ? `# <<custom:${value}>>` : '# <<custom>>';
      break;
  }

  const trimmed = command.trimEnd();
  return trimmed + '\n' + labelStr;
}

export function getLabelPriority(type: CommentLabelType): number {
  const pattern = LABEL_PATTERNS.find((p) => p.type === type);
  return pattern ? pattern.priority : 0;
}

export function isHighConfidenceLabel(
  label: CommentLabel,
  threshold?: number
): boolean {
  return label.confidence >= (threshold ?? 0.7);
}
