import { getLogger } from '@modules/monitoring';
import { ForkedDreamExecutor } from './ForkedDreamExecutor';
import type { ForkedDreamResult } from './ForkedDreamExecutor';

const logger = getLogger('tasks:dreamPhases');

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

/**
 * 只读工具清单（2026-09-26 修复 P3-2 顺查项③）。
 *
 * 原清单是 CC 名（`read_file` / `search_code` / `list_files` / `get_file_info` / `memory_search` /
 * `session_list` / `task_status` / `plan_list` 等），本仓**一个都不存在** ⇒ 判定恒为 false。
 * 现按工具类声明的真实名映射；**本仓无对应工具者直接移除**（不臆造名字）：
 * - `read_file`→`file_read`、`search_code`→`file_search`、`session_list`→`sessions`、
 *   `session_history`→`sessions_history`、`task_list`→`get_task_list`、`task_status`→`view_tasks`、
 *   `plan_list`→`view_plan`；
 * - **移除**：`list_files`、`get_file_info`、`memory_search`（本仓无同名工具；不加"近义替代"以免误判）。
 *
 * 导出仅为**防漂移守卫**可在用例里直接断言。
 */
export const READ_ONLY_TOOLS = new Set([
  'file_read',
  'file_search',
  'glob',
  'grep',
  'web_search',
  'web_fetch',
  'sessions',
  'sessions_history',
  'get_task_list',
  'view_tasks',
  'view_plan',
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
