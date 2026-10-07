/**
 * SleepTool 睡眠/延迟工具
 * 让 Agent 在执行流程中暂停指定时间
 */
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SleepTool:SleepTool');

interface SleepInput {
  durationMs: number;
  reason?: string;
}

export class SleepTool extends BaseTool<Record<string, unknown>> {
  name = 'sleep';
  description =
    '暂停执行指定时长。当需要在继续之前等待时使用（例如等待资源、限流或计时）。';
  params: ToolParam[] = [
    {
      name: 'durationMs',
      type: 'number',
      description: '睡眠时长（毫秒，最小 100，最大 300000）',
      required: true,
      minimum: 100,
      maximum: 300000,
    },
    {
      name: 'reason',
      type: 'string',
      description: '可选的睡眠原因',
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
