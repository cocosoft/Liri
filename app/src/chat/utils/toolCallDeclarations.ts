// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * assistant 消息的 `metadata.tool_calls` **声明构造与合并**（2026-11-20）
 *
 * 背景（真机取证）：`ReActToolLoop` 在同一轮里复用同一个 `assistantMessage` 跨多步 ReAct，
 * 旧实现每步都 `metadata.tool_calls = <本步 response.tool_calls>` ⇒ **覆盖**前一步的声明。
 * 实测 `msg-turn-mwmumwam-39d44c`：事件侧有 2 个 `assistant/tool_call`（seq 14 bash、seq 21 file_write），
 * 落盘只声明了后一个 ⇒ 其余 tool 结果在消息库里成"孤儿" ⇒ `ChatCompletionsTransport` 按 provider
 * 严格要求剥离（真机日志 `count:43 / totalMessages:53`）⇒ **模型看不到这些工具输出**。
 *
 * 本模块只做**纯数据变换**：按 id 去重、保持先到顺序；同 id 再出现时以后到者为准（重放/续写安全）。
 */

/** 声明项的最小形状（`type/function` 透传，不解析参数） */
export interface ToolCallDeclaration {
  id?: string;
  [key: string]: unknown;
}

/** provider 响应里的工具调用（只读最小面） */
export interface ResponseToolCallLike {
  id?: string;
  name?: string;
  arguments?: unknown;
}

/**
 * 合并同一 assistant 消息上的多步 tool_calls 声明。
 *
 * @param existing 已落盘/已在内存的声明（缺省 ⇒ 视为空）
 * @param incoming 本步新产生的声明
 * @returns 合并后的新数组（**不修改入参**）
 */
export function mergeToolCallDeclarations(
  existing: readonly ToolCallDeclaration[] | undefined,
  incoming: readonly ToolCallDeclaration[]
): ToolCallDeclaration[] {
  const out: ToolCallDeclaration[] = [];
  const indexById = new Map<string, number>();

  const put = (call: ToolCallDeclaration): void => {
    const id = typeof call.id === 'string' ? call.id : '';
    if (id && indexById.has(id)) {
      // 同 id：以后到者为准（重放/续写不产生重复声明）
      out[indexById.get(id) as number] = call;
      return;
    }
    if (id) indexById.set(id, out.length);
    out.push(call);
  };

  for (const call of existing ?? []) put(call);
  for (const call of incoming) put(call);
  return out;
}

/** provider 响应 → `metadata.tool_calls` 形态（arguments 字符串化） */
export function toToolCallDeclarations(
  calls: readonly ResponseToolCallLike[]
): ToolCallDeclaration[] {
  return calls.map((tc) => ({
    id: tc.id ?? '',
    type: 'function',
    function: {
      name: tc.name ?? '',
      arguments:
        typeof tc.arguments === 'string'
          ? tc.arguments
          : JSON.stringify(tc.arguments ?? {}),
    },
  }));
}

/**
 * 取 `metadata.tool_calls` 并合并本步声明（宿主一行调用）。
 *
 * @param existingMetadata 现有消息 metadata（可能为空/异形 ⇒ 视为无声明）
 * @param calls 本步响应里的工具调用
 */
export function mergeResponseToolCalls(
  existingMetadata: unknown,
  calls: readonly ResponseToolCallLike[]
): ToolCallDeclaration[] {
  const previous = (
    existingMetadata as { tool_calls?: ToolCallDeclaration[] } | undefined
  )?.tool_calls;
  return mergeToolCallDeclarations(previous, toToolCallDeclarations(calls));
}
