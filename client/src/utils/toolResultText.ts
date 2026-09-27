// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * toolResultText —— 工具结果文本的解包/解码（**单一实现**，2026-09-27）
 *
 * 背景（真机 + 导出产物实证）：后端持久化的 tool 消息 content 是"工具结果信封"
 *   `[{"type":"tool_result","value":"<结果>","toolCallId":"call_x"}]`
 *   ① 渲染侧（工具卡 / 孤儿卡片）与导出侧都需要**展示 value**，而不是信封 JSON；
 *   ② 信封里的 `value` 常为**字符串化的 JSON**（`"value":"\"{\\n  \\\"a\\\"…}"`），
 *      只解一层仍留 `\"` 转义噪声 ⇒ 需**迭代解码**；
 *   ③ 存在**空信封**（无 `value`）⇒ 返回空串，由调用方决定兜底文案。
 *
 * 依赖方向：放 utils（纯函数、无 store/组件依赖），供 stores / components / utils 共同引用，
 * 避免 utils → stores 的反向依赖（R03-002）。
 */

/**
 * 解出 tool 消息 content 中的**工具结果信封**；非信封（普通 JSON / 纯文本）**原样返回**。
 */
export function unwrapToolResultEnvelope(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // @ignore-catch — 非 JSON（纯文本工具输出）：按原样展示
    return value;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return value;

  const values: string[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return value;
    const it = item as { type?: unknown; value?: unknown };
    if (it.type !== "tool_result") return value;
    values.push(
      typeof it.value === "string"
        ? it.value
        : JSON.stringify(it.value ?? "", null, 2),
    );
  }
  return values.length > 0 ? values.join("\n\n") : value;
}

/** 迭代解码层数上限（防畸形深层嵌套导致的长循环） */
const MAX_DECODE_DEPTH = 3;

/**
 * 工具结果的**展示/导出**文本：解信封 → 迭代解码嵌套 JSON 字符串 → JSON pretty-print。
 *
 * 返回空串表示"无返回内容"（空信封）；调用方自行决定兜底文案。
 */
export function decodeToolResultContent(value: string): string {
  let text = unwrapToolResultEnvelope(value);

  // 迭代解码：value 常为字符串化 JSON（形如 "\"{\\n \\\"a\\\": 1}\""）
  for (let i = 0; i < MAX_DECODE_DEPTH; i++) {
    const trimmed = text.trim();
    if (
      trimmed.length < 2 ||
      !trimmed.startsWith('"') ||
      !trimmed.endsWith('"')
    )
      break;
    try {
      const inner: unknown = JSON.parse(trimmed);
      if (typeof inner !== "string") break;
      text = inner;
    } catch {
      // @ignore-catch — 引号包裹但非合法 JSON 字符串：停止解码，原样展示
      break;
    }
  }

  // JSON 对象/数组 ⇒ pretty-print（可读性）；否则原样返回
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // @ignore-catch — 形似 JSON 但非法（如工具输出的花括号文本）：原样展示
    }
  }
  return text;
}
