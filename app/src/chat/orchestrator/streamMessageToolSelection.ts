/**
 * streamMessageFlow 的「**本轮工具集选择**」——任务类型判定 + 按任务裁剪（P2-1i）。
 *
 * 动因（S3 工具调用 / 上下文预算）：该段此前**内联**在 `runStreamMessage`（约 62 行）：先按
 * 「调用方显式 `metadata.taskType` > 本地 LLM 端点（llama.cpp/ollama）→ `local`」定任务类型，
 * 再叠加 **K4（2026-09-06）项目执行意图提升 coding**、**D7/L2（2026-09-10）带图保留 image 类**，
 * 最后 `filterToolsByTask` 裁剪。判据与两条历史修复的动因全部沉在编排函数里 ⇒ 无法独立测试。
 *
 * 拆分手法（与 P2-1d-3 / P2-1d-4 / P2-1h 一致）：**判据/变换外移、动作留下** ——
 * 本模块给出「最终任务类型 + 裁剪后工具集 + 留痕所需的差集」，**`logger.info` 的实际调用
 * 与 `toolDefinitions` 的原地替换留在编排函数**。
 *
 * 依赖方向：本模块依赖 `@modules/tools`（`filterToolsByTask`）、`../services/ChatHelper`（本地端
 * 点判定）、`../taskIntent`（执行意图判定）—— 均为 chat 编排层既有依赖，无新环。
 */

import { filterToolsByTask, type ToolCategory } from '@modules/tools';
import type { ToolDefinition } from '@modules/ai';
import { isLocalLlmEndpoint } from '../services/ChatHelper.js';
import { isExecutionTaskIntent } from '../taskIntent.js';

export interface ToolSelectionInput {
  /** 全量工具定义（调用方此前可能已注入 `session_lookup` 等） */
  tools: ToolDefinition[];
  /** 调用方显式指定的任务类型（`options.metadata.taskType`；**非字符串视为未指定**） */
  explicitTaskType: unknown;
  /** 本轮 provider 的 baseUrl（用于本地 LLM 端点判定）；未取到 ⇒ `undefined` */
  baseUrl?: string;
  /** 会话 `metadata.projectId`（仅**项目会话**触发执行意图提升） */
  projectId?: string;
  /** 最后一条用户消息文本（执行意图判定输入） */
  lastUserText: string;
  /** 本轮是否带图片（带图必须保留 image 类工具，D7/L2） */
  hasImages: boolean;
}

export interface ToolSelectionResult {
  /** 最终任务类型（可能 `undefined` ⇒ 取保底 default 集） */
  taskType: string | undefined;
  /** 是否因【项目会话 + 执行意图】被提升为 `coding`（供调用方留痕） */
  promotedByExecutionIntent: boolean;
  /** 裁剪后的工具集 */
  tools: ToolDefinition[];
  /** 被裁掉的工具名（与原实现同口径：原顺序，`function.name ?? ''`） */
  removedNames: string[];
  /** 是否发生裁剪（`filtered.length !== tools.length`，与原实现同口径） */
  trimmed: boolean;
}

/**
 * 选定本轮任务类型并裁剪工具集。
 *
 * 判定优先级（与拆分前**逐字等价**）：
 * 1. 调用方显式 `metadata.taskType`（字符串且非空）；
 * 2. 本地 LLM 端点（`isLocalLlmEndpoint(baseUrl)`）⇒ `'local'` 只读轻量集；
 * 3. **K4**：`!taskType && projectId && isExecutionTaskIntent(lastUserText)` ⇒ `'coding'`。
 *    default/chat 集无 shell ⇒ bash/powershell 对模型不可见 ⇒ PDL/PDCA/执行类任务
 *    （如"写单测并跑 bun test"）无法执行命令即失败（复测实证：57→25，removedNames 含 bash）。
 *    仅【projectId 会话 + 最后一条用户消息命中执行意图】触发；**命令执行仍走审批放行**
 *    （BashTool/ApprovedCommandRegistry），安全底线不变。
 * 4. **D7/L2**：带图消息追加 `'image'` 额外类别 —— 否则 default/chat 集不含 image 类别，
 *    裁剪后模型函数列表无 image_analysis ⇒ 识图链路不可用（会话实录实证）。
 *
 * ⚠️ 本函数会调用 `filterToolsByTask`（其内部对"未登记类别工具"有**一次性告警**副作用）——
 * 与拆分前调用同源，行为不变。
 */
export function selectToolsForTurn(
  input: ToolSelectionInput
): ToolSelectionResult {
  const { tools } = input;
  let taskType =
    (typeof input.explicitTaskType === 'string' && input.explicitTaskType
      ? input.explicitTaskType
      : undefined) ??
    (input.baseUrl && isLocalLlmEndpoint(input.baseUrl) ? 'local' : undefined);
  let promotedByExecutionIntent = false;
  if (
    !taskType &&
    input.projectId &&
    isExecutionTaskIntent(input.lastUserText)
  ) {
    taskType = 'coding';
    promotedByExecutionIntent = true;
  }
  const extraCategories: ToolCategory[] = input.hasImages ? ['image'] : [];
  const filteredTools = filterToolsByTask(tools, taskType, extraCategories);
  const removedNames = tools
    .filter((t) => !filteredTools.includes(t))
    .map((t) => t.function?.name ?? '');
  return {
    taskType,
    promotedByExecutionIntent,
    tools: filteredTools,
    removedNames,
    trimmed: filteredTools.length !== tools.length,
  };
}
