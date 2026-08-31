/**
 * ToolResultPersister — 工具结果二级防御（落盘路径引用 + 单轮聚合 spill）
 *
 * 对标 hermes `tools/tool_result_storage.py` 的三级防御：
 *   一级：工具内 cap（maxResultSizeChars，已有）
 *   二级：单条超限结果落盘 `~/.pyapp/data/tool-results/{toolCallId}.txt`，
 *         上下文替换为 preview + 路径引用（模型可 read_file 读全量）
 *   三级：单轮全部结果聚合超预算（TURN_BUDGET_CHARS）→ spill 未持久化结果
 *
 * 背景（2026-08-31）：历史 822KB 工具结果直接全量进上下文引发 OOM；
 * 原实现（ChatManager._buildToolRoundMessages）对工具结果 JSON.stringify 无截断。
 */
import { resolveDataSubDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ToolResult } from '../types/ToolResult';

const logger = getLogger('tools:toolResultPersister');

/** 单条工具结果字符预算（超过则落盘，上下文只留 preview + 路径引用） */
export const SINGLE_RESULT_LIMIT_CHARS = 50_000;
/** 单轮全部工具结果聚合预算（合计超限则 spill 未持久化结果） */
export const TURN_BUDGET_CHARS = 200_000;
/** 上下文内 preview 保留长度 */
export const PREVIEW_CHARS = 8_000;

/** 落盘目录名（resolveDataSubDir 挂 ~/.pyapp/data/ 下） */
const TOOL_RESULTS_DIR = 'tool-results';

/** 生成路径引用替换文本 */
export function buildPathRefNotice(path: string): string {
  return `\n\n[工具结果超出上下文预算，完整内容已保存到 ${path}；如需查看可用 read_file 工具读取该路径]`;
}

/** 工具结果落盘路径（toolCallId 做安全化，防路径注入） */
export function toolResultPath(toolCallId: string): string {
  const safe = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(resolveDataSubDir(TOOL_RESULTS_DIR), `${safe}.txt`);
}

/** 将完整工具结果写入落盘，返回路径 */
export async function persistToolResult(
  toolCallId: string,
  content: string
): Promise<string> {
  const dir = resolveDataSubDir(TOOL_RESULTS_DIR);
  await mkdir(dir, { recursive: true });
  const path = toolResultPath(toolCallId);
  await writeFile(path, content, 'utf8');
  logger.info('tool_result:persisted', {
    toolCallId,
    chars: content.length,
    path,
  });
  return path;
}

/** 提取工具结果的可序列化文本（与 _buildToolRoundMessages 的 JSON.stringify 一致） */
function extractResultText(result: ToolResult): string {
  if (typeof result.result === 'string') return result.result;
  if (result.result !== undefined) return JSON.stringify(result.result);
  if (result.error) return result.error;
  return '{}';
}

/**
 * 工具结果入上下文预处理（二级 + 三级防御）。
 * 就地替换 processedResults 中每个 result 为"preview + 路径引用"版本，
 * 并将完整内容落盘（metadata 保留 toolResultPath 供调试/前端）。
 */
export async function prepareToolResultsForContext(
  processedResults: Array<{
    normalizedToolCall: { id: string; name: string };
    result: ToolResult;
  }>
): Promise<void> {
  if (processedResults.length === 0) return;

  // 先提取文本与长度，统计单轮聚合
  const items = processedResults.map((pr) => {
    const content = extractResultText(pr.result);
    return { pr, content, len: content.length };
  });
  const turnTotal = items.reduce((s, c) => s + c.len, 0);
  const needsTurnSpill = turnTotal > TURN_BUDGET_CHARS;

  // 超限 spill 时从最大的开始（hermes 语义），减少上下文膨胀
  const overItems = items
    .filter((c) => c.len > SINGLE_RESULT_LIMIT_CHARS || needsTurnSpill)
    .sort((a, b) => b.len - a.len);

  for (const item of overItems) {
    const toolCallId = item.pr.normalizedToolCall.id;
    try {
      const path = await persistToolResult(toolCallId, item.content);
      const preview = item.content.slice(0, PREVIEW_CHARS);
      const notice = buildPathRefNotice(path);
      item.pr.result = {
        ...item.pr.result,
        result: preview + notice,
        metadata: {
          ...(item.pr.result.metadata ?? {}),
          toolResultPath: path,
          toolResultFullChars: item.len,
        },
      };
      logger.info('tool_result:context_replaced', {
        toolCallId,
        toolName: item.pr.normalizedToolCall.name,
        fullChars: item.len,
        previewChars: preview.length,
        reason:
          item.len > SINGLE_RESULT_LIMIT_CHARS
            ? 'single_budget'
            : 'turn_budget',
      });
    } catch (e) {
      // 落盘失败不阻断工具轮（保留原结果，仅记录）——CS03 回退最小化：落盘是本机 IO，
      // 失败概率极低，失败时保留原文进上下文
      logger.warn('tool_result:persist_failed', {
        toolCallId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
