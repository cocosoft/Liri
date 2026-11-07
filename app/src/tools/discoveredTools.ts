/**
 * 会话级「tool_search 已发现工具」登记（2026-11-07，承接方案 §6.4）
 *
 * 背景：`tool_search` 只回**工具名**（`matches: string[]`），而模型能否直接调用取决于
 * 本轮**工具定义**里有没有它的 schema。`default`/`chat` 面只有 12–13 个工具，其余几十个
 * 虽已注册、执行也不拦（后端按注册表解析），但模型看不到 schema 就不会主动调用。
 *
 * 本模块只负责**记住**"这个会话搜索到过哪些工具"；把它们补进下一轮工具定义由
 * `selectToolsForTurn` 的 `discoveredToolNames` 入参消费。
 *
 * ⚠️ 边界：
 *  - 仅**内存**、按会话隔离，LRU 上限 200 个会话 ⇒ 不落盘、不跨进程；
 *  - 每会话最多记 **20** 个名字（搜索一次可能命中多个），超出丢弃最早的；
 *  - **不改可见性语义**：补回仍受"有意归档"（`ARCHIVED_MISC_TOOLS`）与用户覆写约束（见调用方）。
 */
import { LRUCache } from '@openliri/infra/utils/cache';
import type { ToolDefinition } from '@modules/ai';
import { buildToolDefinitions, toWireToolName } from './toolNameCodec';
import type { ToolSchemaLike } from './toolNameCodec';

/** 会话 → 已发现工具名（LRU 上限 200 个会话，避免长期运行的内存增长） */
const discoveredBySession = new LRUCache<readonly string[]>(200);

/**
 * 登记一次搜索命中的工具名（去重、保序、每会话最多 20 个）。
 *
 * @param sessionId 会话 id（空 / 缺省 ⇒ 忽略，避免把无会话调用写进共享桶）
 * @param toolNames 命中的**真实工具名**（`skill:<name>` 之类引导项应被调用方过滤掉）
 */
export function recordDiscoveredTools(
  sessionId: string | undefined,
  toolNames: readonly string[]
): void {
  if (!sessionId || toolNames.length === 0) return;
  const previous = discoveredBySession.get(sessionId) ?? [];
  const merged = [...new Set([...previous, ...toolNames])];
  // 每会话最多 20 个：超出只保留最近 20（`tool_search` 会重复命中，保持尾部即可）
  discoveredBySession.set(
    sessionId,
    merged.length > 20 ? merged.slice(merged.length - 20) : merged
  );
}

/** 取该会话已发现的工具名（无 ⇒ `[]`） */
export function getDiscoveredTools(sessionId: string): readonly string[] {
  return discoveredBySession.get(sessionId) ?? [];
}

/** 清空某会话的登记（会话结束 / 显式重置时调用） */
export function clearDiscoveredTools(sessionId: string): void {
  discoveredBySession.delete(sessionId);
}

/** 测试用：清空全部（避免用例间串味） */
export function resetDiscoveredToolsForTest(): void {
  discoveredBySession.clear();
}

/**
 * 把该会话**已发现**但当前工具定义里没有的工具，按名补进 `target`（**原地 push**）。
 *
 * 调用时机：工具刚执行完（见 `streamMessageToolLoopContext` 的 `executeTool`）——
 * 工具轮的每次 LLM 请求都现读 `ctx.toolDefinitions`（`StreamingLlm`），
 * ⇒ 补进去之后**同一轮的下一次请求**就能看到 schema（不再等下一用户轮）。
 *
 * 幂等：已在 `target` 里的不重复加；返回本次真正补进去的 **wire 名**（供调用方留痕）。
 *
 * @param target 工具轮的 `ctx.toolDefinitions`（数组身份不变，原地追加）
 * @param sessionId 会话 id
 * @param schemas 注册表全量 schema（由调用方提供，避免本模块反向依赖 ToolRegistry）
 */
export function expandToolDefinitionsWithDiscovered(
  target: ToolDefinition[],
  sessionId: string,
  schemas: readonly ToolSchemaLike[]
): string[] {
  const names = getDiscoveredTools(sessionId);
  if (names.length === 0) return [];
  const present = new Set(target.map((t) => t.function?.name ?? ''));
  const wanted = new Set(
    names.map((n) => toWireToolName(n)).filter((n) => !present.has(n))
  );
  if (wanted.size === 0) return [];
  const matched = schemas.filter((s) => wanted.has(toWireToolName(s.name)));
  if (matched.length === 0) return [];
  const added = buildToolDefinitions(matched);
  target.push(...added);
  return added.map((d) => d.function?.name ?? '');
}
