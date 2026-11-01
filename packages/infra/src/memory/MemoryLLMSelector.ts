/**
 * MemoryLLMSelector — LLM 精选记忆检索
 *
 * P2-6: 对标 cc_code findRelevantMemories (Sonnet 从所有记忆中选 Top5)。
 * 避免无关记忆浪费上下文，使用轻量 LLM 从记忆中精选最相关条目。
 */
export interface MemoryItem {
  id: string;
  type: string;
  content: string;
  createdAt: number;
}

export interface SelectionConfig {
  maxItems: number; // 最多返回 N 条，默认 5
  maxCharsPerItem: number; // 单条最大字符数
}

const DEFAULT_CONFIG: SelectionConfig = { maxItems: 5, maxCharsPerItem: 300 };

/**
 * P2-6: 构建精选记忆的 prompt（发送给轻量 LLM）
 */
export function buildSelectionPrompt(
  query: string,
  memories: MemoryItem[]
): string {
  const trimmed = memories.map(
    (m) => `[${m.id}] (${m.type}) ${m.content.slice(0, 200)}`
  );
  return `你是记忆选择器。给定用户当前的查询与一组记忆，请选出最相关的 ${DEFAULT_CONFIG.maxItems} 条记忆。

当前查询："${query}"

记忆列表：
${trimmed.map((t, i) => `${i + 1}. ${t}`).join('\n')}

只返回与查询最相关的记忆 ID，以 JSON 字符串数组形式给出：["id1", "id2", ...]`;
}

/**
 * P2-6: 解析 LLM 返回的精选 ID 列表
 */
export function parseSelectionResult(raw: string): string[] {
  // Try JSON.parse first
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* not valid JSON, try regex fallback */
  }

  // Fallback: extract IDs from bracket notation
  const match = /\[([^\]]+)\]/.exec(raw);
  if (match) {
    return match[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
  }
  return [];
}

/**
 * P2-6: 应用精选结果，只返回匹配的记忆
 */
export function applySelection(
  memories: MemoryItem[],
  selectedIds: string[]
): MemoryItem[] {
  if (selectedIds.length === 0)
    return memories.slice(0, DEFAULT_CONFIG.maxItems);
  const idSet = new Set(selectedIds);
  return memories.filter((m) => idSet.has(m.id));
}
