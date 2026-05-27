/**
 * Agent Tool Display
 * 对标CC agentDisplay.ts
 * Agent工具输出显示/格式化
 */

import type { AgentOutput } from './UI';

export interface DisplayOptions {
  compact?: boolean;
  showTiming?: boolean;
  showTokenUsage?: boolean;
  maxDescriptionLength?: number;
}

const DEFAULT_OPTIONS: Required<DisplayOptions> = {
  compact: false,
  showTiming: true,
  showTokenUsage: true,
  maxDescriptionLength: 200,
};

export interface DisplaySegment {
  type: 'header' | 'status' | 'metric' | 'content' | 'error' | 'separator';
  label?: string;
  value: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

export function formatAgentOutput(
  output: AgentOutput,
  options?: DisplayOptions
): DisplaySegment[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const segments: DisplaySegment[] = [];

  if (output.agentName || output.agentType) {
    segments.push({
      type: 'header',
      value: output.agentName ?? output.agentType ?? 'Agent',
      level: 'info',
    });
  }

  if (output.completed !== undefined) {
    segments.push({
      type: 'status',
      label: 'Status',
      value: output.completed ? 'Completed' : 'In Progress',
      level: output.completed ? 'success' : 'warning',
    });
  }

  if (opts.showTiming && output.duration !== undefined) {
    const duration =
      output.duration < 1000
        ? `${output.duration}ms`
        : `${(output.duration / 1000).toFixed(2)}s`;

    segments.push({
      type: 'metric',
      label: 'Duration',
      value: duration,
      level: 'info',
    });
  }

  if (opts.showTokenUsage && output.tokenUsage) {
    segments.push({
      type: 'metric',
      label: 'Tokens',
      value: `↑${output.tokenUsage.input} / ↓${output.tokenUsage.output}`,
      level: 'info',
    });
  }

  if (output.description) {
    const desc =
      output.description.length > opts.maxDescriptionLength
        ? output.description.slice(0, opts.maxDescriptionLength) + '...'
        : output.description;

    segments.push({
      type: 'content',
      value: desc,
      level: 'info',
    });
  }

  if (output.error) {
    segments.push({
      type: 'error',
      value: output.error,
      level: 'error',
    });
  }

  if (output.result) {
    segments.push({
      type: 'separator',
      value: '---',
    });
    segments.push({
      type: 'content',
      value: output.result,
      level: 'info',
    });
  }

  return segments;
}

export function summarizeAgentOutput(output: AgentOutput): string {
  const parts: string[] = [];

  if (output.agentName) parts.push(output.agentName);
  if (output.completed) parts.push('✓');
  else if (output.completed === false) parts.push('⟳');

  if (output.error) {
    parts.push(`Error: ${output.error.slice(0, 60)}`);
  } else if (output.result) {
    const preview = output.result.replace(/<[^>]+>/g, '').trim();
    parts.push(preview.slice(0, 80));
  }

  return parts.join(' – ') || 'Agent output';
}

export function formatAgentTiming(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export interface MergedAgentOutput extends AgentOutput {
  agentCount: number;
  results: string[];
}

export function mergeAgentResults(outputs: AgentOutput[]): MergedAgentOutput {
  const merged: MergedAgentOutput = {
    completed: outputs.every((o) => o.completed),
    duration: outputs.reduce((sum, o) => sum + (o.duration ?? 0), 0),
    tokenUsage: outputs.reduce(
      (sum, o) => {
        if (o.tokenUsage) {
          sum.input += o.tokenUsage.input;
          sum.output += o.tokenUsage.output;
        }
        return sum;
      },
      { input: 0, output: 0 }
    ),
    agentCount: outputs.length,
    results: outputs.map((o) => o.result).filter(Boolean) as string[],
  };

  const firstError = outputs.find((o) => o.error);
  if (firstError?.error) merged.error = firstError.error;

  return merged;
}
