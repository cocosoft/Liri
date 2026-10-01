import { getLogger } from '@modules/monitoring';
import type { ToolName } from '@modules/constants/toolNames.generated';
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
 * - `read_file`→`file_read`、`session_list`→`sessions`、`task_list`→`get_task_list`；
 * - **移除**：`list_files`、`get_file_info`、`memory_search`（本仓无同名工具；不加"近义替代"以免误判）。
 * - **移除（2026-09-29 台账 D-34）**：`file_search`、`sessions_history`、`view_tasks`、`view_plan`
 *   —— 这 4 个名字**不在生效注册面**（前者仅在 `ToolFactory.getAllBaseTools()` 死路径，台账 N-27；
 *   后三者类已删，属**被取代/重复**而非"待注册"：`view_tasks`/`view_plan` 职能已被活工具
 *   `get_task_list` / `update_task_status` 覆盖，`sessions_history` 由 `sessions`（`action=history`）取代）。
 *   它们曾以"台账 D-15 将来会注册 ⇒ 刻意保留"为由挂着；D-34 已裁定该前提不成立 ⇒ 一并移除。
 *
 * 导出仅为**防漂移守卫**可在用例里直接断言。
 */
const READ_ONLY_TOOL_NAMES = [
  'file_read',
  'glob',
  'grep',
  'web_search',
  'web_fetch',
  'sessions',
  'get_task_list',
] as const satisfies readonly ToolName[];
export const READ_ONLY_TOOLS = new Set<string>(READ_ONLY_TOOL_NAMES);
// 2026-09-29（P2-3/T2）：移除 `'file_search'` —— 它**不是**注册名（仅存在于 `ToolFactory.getAllBaseTools()`
// 的死路径，台账 N-27；真实类 `FileSearchTool` 亦无 loader 引用）⇒ 属"永不命中的假覆盖"。
// 2026-09-29（D-34 收尾）：上列名字现由 `satisfies readonly ToolName[]` **编译期**校验（T2 手法）；
// 守卫用例（对照生成物 `TOOL_NAMES`）仍保留，作**运行期**双重保险。

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
