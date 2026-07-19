/**
 * SleepTool 睡眠/延迟工具
 * 让 Agent 在执行流程中暂停指定时间
 */
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:SleepTool:SleepTool',
  level: LogLevel.INFO,
});

interface SleepInput {
  durationMs: number;
  reason?: string;
}

export class SleepTool extends BaseTool<Record<string, unknown>> {
  name = 'sleep';
  description =
    'Pause execution for a specified duration. Use when you need to wait before proceeding (e.g., waiting for a resource, rate limiting, or timing).';
  params: ToolParam[] = [
    {
      name: 'durationMs',
      type: 'number',
      description: 'Duration to sleep in milliseconds (min: 100, max: 300000)',
      required: true,
      minimum: 100,
      maximum: 300000,
    },
    {
      name: 'reason',
      type: 'string',
      description: 'Optional reason for sleeping',
      required: false,
    },
  ];

  override aliases = ['wait', 'delay', 'pause'];
  override searchHint = 'Pause execution for a duration';

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const { durationMs, reason } = input as unknown as SleepInput;

      if (!durationMs || typeof durationMs !== 'number') {
        return {
          success: false,
          error: 'durationMs is required and must be a number',
        };
      }

      if (durationMs < 100) {
        return { success: false, error: 'durationMs must be at least 100ms' };
      }

      if (durationMs > 300000) {
        return {
          success: false,
          error: 'durationMs must not exceed 300000ms (5 minutes)',
        };
      }

      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      const elapsed = Date.now() - start;

      const reasonNote = reason ? ` Reason: ${reason}` : '';

      return {
        success: true,
        data: { durationMs, elapsed, reason },
        output: `Slept for ${elapsed}ms.${reasonNote}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Sleep tool failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createSleepTool(): SleepTool {
  return new SleepTool();
}
