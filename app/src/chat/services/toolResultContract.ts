/**
 * 工具结果三态契约（2026-11-01）
 *
 * 背景：工具结果只有「成功 / 失败」两态时，**成功但无输出**与「调用没生效」在模型侧不可区分 ——
 * `JSON.stringify(undefined)` ⇒ `undefined`、`JSON.stringify('')` ⇒ `""`，模型收到空串后
 * 常见反应是「换个措辞把同一个动作再做一遍」（外部分析记录的 23:53–23:54 空转现象）。
 *
 * 本模块把判定与文案收成**单一事实源**：`MessageService.createToolResultMessage`（ReAct 串行/
 * 并发与非循环路径共用的唯一收口）只调用这里，不在别处再写一遍判据（CS01 归一化）。
 *
 * 判据边界（**刻意窄**）：
 *   · 只有 `undefined` / `null` / 纯空白字符串算「成功无输出」；
 *   · `[]`、`{}`、`"0"`、`"false"` 等**有语义的空容器/假值原样透传** ——
 *     `grep` 的「零命中」是结论，不是"没输出"，套用提示会误导模型。
 */

import type { ToolResult } from '@modules/session/types/tool';

/** 工具结果三态：失败 / 成功但无输出 / 成功且有输出 */
export type ToolResultTristate = 'error' | 'empty-success' | 'success';

/**
 * 「成功但无输出」时回灌模型的正文明文。
 *
 * 措辞要点：① 明确**不是失败**（避免模型自行降级重试）；② 明确**不要用相同参数重调**
 * （与 `ReActToolLoop._injectRepeatCallCorrection` 的软纠偏同向）；③ 给出可选的下一步。
 */
export const EMPTY_SUCCESS_TOOL_RESULT_TEXT =
  '（工具执行成功，无输出）\n\n' +
  '该工具已执行成功，只是没有返回任何内容 —— 这不代表失败，也不代表没有执行。' +
  '请勿使用相同参数重复调用同一个工具；若仍缺信息，请更换工具或参数，或直接向用户说明现状。';

/** 判定工具结果属于哪一态（只读 `result` / `error`，不触碰其它字段） */
export function classifyToolResult(
  toolResult: Pick<ToolResult, 'result' | 'error'>
): ToolResultTristate {
  if (toolResult.error) return 'error';
  const result: unknown = toolResult.result;
  if (result === undefined || result === null) return 'empty-success';
  if (typeof result === 'string' && result.trim() === '') {
    return 'empty-success';
  }
  return 'success';
}

/**
 * 工具载荷 → 文本（**单一实现**）：字符串**直通**，其余 JSON 化。
 *
 * 2026-11-24（会话 `session_mwurduuh1b0b38db30` 复盘）：原实现对**字符串**载荷也
 * `JSON.stringify` ⇒ 纯文本出参被再套一层引号、`\r\n` 变成**字面量** `\\r\\n`
 * （模型读到 `"1:.bun-cache\r\n2:.bun..."`，不可读且体积约翻倍；真机 265 条结果里
 * 134 条是该形态，bash 36/44、file_read 97/99）。结构化出参（对象/数组）仍 JSON 化。
 *
 * `undefined` 保持 `undefined`（`JSON.stringify(undefined)` 的既有语义）——
 * 空值判定由调用方（`classifyToolResult` / `toToolResultRawText`）负责，不在本函数臆造 `'{}'`。
 */
export function toolResultPayloadText(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload);
}
