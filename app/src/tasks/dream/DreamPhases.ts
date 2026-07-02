import { Logger, LogLevel } from '@modules/monitoring';
import { ForkedDreamExecutor } from './ForkedDreamExecutor';
import type { ForkedDreamResult } from './ForkedDreamExecutor';

const logger = new Logger({
  module: 'tasks:dreamPhases',
  level: LogLevel.INFO,
});

export type DreamPhase = 'light' | 'deep' | 'rem';

export interface DreamPhaseConfig {
  phase: DreamPhase;
  maxDurationMs: number;
  thinkingPrompt: string;
  readOnlyTools?: boolean;
}

export interface MultiPhaseDreamResult {
  phases: ForkedDreamResult[];
  overallSuccess: boolean;
  totalDurationMs: number;
  combinedThoughts: string[];
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'search_code',
  'glob',
  'grep',
  'list_files',
  'get_file_info',
  'web_search',
  'web_fetch',
  'memory_search',
  'session_list',
  'session_history',
  'task_list',
  'task_status',
  'plan_list',
]);

export function isToolReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export type DreamPhaseProgressCallback = (
  phase: DreamPhase,
  pct: number,
  msg: string
) => void;

export class MultiPhaseDreamExecutor {
  async execute(
    configs: DreamPhaseConfig[],
    onProgress?: DreamPhaseProgressCallback
  ): Promise<MultiPhaseDreamResult> {
    const results: ForkedDreamResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];

      onProgress?.(cfg.phase, 0, `启动 ${cfg.phase} 阶段`);

      logger.info('[DreamPhases] 开始阶段', {
        phase: cfg.phase,
        durationMs: cfg.maxDurationMs,
        readOnly: cfg.readOnlyTools ?? false,
      });

      const executor = new ForkedDreamExecutor({
        thinkingPrompt: `[${cfg.phase.toUpperCase()}] ${cfg.thinkingPrompt}`,
        maxDurationMs: cfg.maxDurationMs,
      });

      executor.on('thought', (content: string) => {
        onProgress?.(cfg.phase, 50, content);
      });

      const result = await executor.waitForResult();

      onProgress?.(
        cfg.phase,
        100,
        `${cfg.phase} 阶段完成 (${result.success ? '成功' : '失败'})`
      );

      results.push(result);
    }

    const combinedThoughts = results.flatMap((r) => r.thoughts);
    const overallSuccess = results.every((r) => r.success);

    return {
      phases: results,
      overallSuccess,
      totalDurationMs: Date.now() - startTime,
      combinedThoughts,
    };
  }
}

export const DREAM_PHASE_DEFAULTS: Record<
  DreamPhase,
  Omit<DreamPhaseConfig, 'thinkingPrompt'>
> = {
  light: { phase: 'light', maxDurationMs: 15000, readOnlyTools: true },
  deep: { phase: 'deep', maxDurationMs: 30000, readOnlyTools: false },
  rem: { phase: 'rem', maxDurationMs: 20000, readOnlyTools: true },
};
