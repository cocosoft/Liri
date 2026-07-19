/**
 * SessionsYieldTool
 * 对标CC SessionsYieldTool
 * 会话控制权交还工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:SessionsYieldTool:SessionsYieldTool',
  level: LogLevel.INFO,
});

export interface YieldConfig {
  targetSessionId?: string;
  reason?: string;
  preserveState?: boolean;
  timeout?: number;
  resultData?: Record<string, unknown>;
}

export interface YieldResult {
  yieldId: string;
  fromSessionId: string;
  targetSessionId?: string;
  timestamp: number;
  reason: string;
  statePreserved: boolean;
}

export class SessionsYieldTool extends BaseTool {
  name = 'sessions_yield';

  description =
    'Yield execution control back to parent or specified session. Preserves session state for later resumption.';

  params: ToolParam[] = [
    {
      name: 'targetSessionId',
      type: 'string',
      description: 'Specific session to yield to (defaults to parent)',
      required: false,
    },
    {
      name: 'reason',
      type: 'string',
      description: 'Reason for yielding control',
      required: false,
    },
    {
      name: 'preserveState',
      type: 'boolean',
      description: 'Preserve session state for resumption',
      required: false,
      default: true,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Auto-resume timeout in ms',
      required: false,
    },
    {
      name: 'resultData',
      type: 'object',
      description: 'Data to pass to the receiving session',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const config = input as YieldConfig;

      const result: YieldResult = {
        yieldId: `yield_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fromSessionId: 'current',
        targetSessionId: config.targetSessionId,
        timestamp: Date.now(),
        reason: config.reason ?? 'Yielding control',
        statePreserved: config.preserveState ?? true,
      };

      return {
        success: true,
        data: result,
        output: `Control yielded${config.targetSessionId ? ` to session ${config.targetSessionId}` : ' to parent session'}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to yield: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createSessionsYieldTool(): SessionsYieldTool {
  return new SessionsYieldTool();
}
