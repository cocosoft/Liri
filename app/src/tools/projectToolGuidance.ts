/**
 * 项目类工具的统一失败指引（W2 / M1，2026-09-25）
 *
 * **背景**：无项目上下文的会话被要求操作项目文件时，模型曾**空转搜索工作区**
 * （实机实测：112 次工具调用 / 180s 未收敛；台账 N-60）。仅靠系统提示词（`outputArtifactBoundary` 段）
 * 只能改善、不能根除 ⇒ 在**工具层早失败并自带出路**：让失败**可判定**（落 `error` 字段，
 * 对齐项目既有约定「工具失败信息必须填充在 error 字段」）且模型有**明确动作**可做。
 *
 * **唯一实现**：`write_project_file` / `read_project_file` 共用本模块的文案与失败构造，
 * 避免两处各写一份而漂移。
 */

import {
  createToolResult,
  ErrorLevel,
  ToolExecutionStatus,
} from './types/ToolResult';
import type { ToolResult } from './types/ToolResult';

const GUIDANCE =
  '若当前会话未绑定项目：请直接**向用户询问项目**（或请用户到项目页发起会话）；' +
  '不要用 grep/glob/read 在工作区里搜寻项目，也不要用 doc_generate / file_write 顶替' +
  '（它们的产物落在全局输出目录，不会登记为项目「成果」）。';

/** 缺少 projectId / relativePath 时的失败文案 */
export function projectIdMissingMessage(): string {
  return `缺少 projectId 或 relativePath 参数。${GUIDANCE}`;
}

/** 指定项目不存在（或已被删除）时的失败文案 */
export function projectNotFoundMessage(projectId: string): string {
  return `项目 ${projectId} 不存在或已被删除。${GUIDANCE}`;
}

/**
 * 项目类工具的失败结果（落 `error` 字段 + `status: FAILURE`，供前端与模型判定）。
 * 见 `../types/ToolResult` 的 `createToolResult` 约定。
 */
export function failProjectTool(
  message: string,
  errorLevel: ErrorLevel
): ToolResult<null> {
  return createToolResult(null, {
    success: false,
    error: message,
    errorLevel,
    status: ToolExecutionStatus.FAILURE,
    newMessages: [{ role: 'assistant' as const, content: message }],
  });
}
