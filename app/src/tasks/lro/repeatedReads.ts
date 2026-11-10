// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * repeatedReads —— 单步内「同参只读调用」短路（2026-11-10）
 *
 * **来源**：`dev_docs/20261109/长程任务修复验收清单-20261109.md` 的「已知未修」条目 ——
 * 真机 `pdca_mw8uz6mf` 第 3 步为列出 2 个文件重复调用 `glob` ×11 + `file_read` ×6（19 次、
 * 约 127k tokens）。既有 `FileIOLoopDetector` 只做「警告 + steering」，第 4 次起也仅是告警，
 * 重复调用**照样真实执行** ⇒ token 与时间照付。
 *
 * **为什么可以短路（且与 2026-10 删掉的结果缓存不同）**：
 *   - 只对**只读工具**生效（`Tool.isReadOnly()`，未声明即视为写 ⇒ 不短路）；
 *   - **排除命令类工具**（`bash` / `powershell` 等）：它们的只读判定依赖命令文本，
 *     且 2026-10 的「结果缓存」事故正出在这类工具上（同一命令重复调用被"假装执行"）；
 *   - 任何**非只读调用**执行后立即清空本步缓存（写可能改变读的结果）；
 *   - 失败 / 被拦截的结果**不入缓存**；
 *   - 同一 key 连续短路 **2 次**后强制真实执行（沿用 `streamMessageLifecycle` 的去重口径：
 *     模型可能因上下文压缩拿不到上文，长期只给 stub 会把它逼成死循环）。
 *
 * 依赖方向：本模块只依赖 infra 的两个纯函数，零宿主依赖（可被 `stepExecution` 直接复用）。
 */

import { toolCallArgsKey } from '@openliri/infra/utils/toolCallKey';
import { isCommandToolName } from '@openliri/infra/utils/toolContract/toolRoles';

/** 同一 key 连续短路上限（超过后强制真实执行，避免"拿不到内容 ⇒ 无限重调"） */
export const MAX_REPEATED_READ_REPLAYS = 2;

/** 短路提示里附带的原文预览长度（独立常量：与工具结果落盘侧的预览不是同一事实） */
const REPEATED_READ_PREVIEW_CHARS = 300;

export interface RepeatedReadCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface CacheEntry {
  result: unknown;
  /** 已被短路的次数（首次真实执行后为 0） */
  hits: number;
}

export type RepeatedReadCache = Map<string, CacheEntry>;

export interface RepeatedReadShortCircuit {
  toolCallId: string;
  toolName: string;
  result: string;
}

/** 该调用是否属于可短路的只读调用（命令类工具一律排除） */
export function isRepeatableRead(name: string, readOnly: boolean): boolean {
  return readOnly && !isCommandToolName(name);
}

function cacheKey(call: RepeatedReadCall): string {
  return `${call.name}:${toolCallArgsKey(call.arguments)}`;
}

function previewOf(result: unknown): string {
  let text: string;
  if (typeof result === 'string') {
    text = result;
  } else {
    try {
      text = JSON.stringify(result ?? '');
    } catch {
      text = String(result);
    }
  }
  return text.length > REPEATED_READ_PREVIEW_CHARS
    ? `${text.slice(0, REPEATED_READ_PREVIEW_CHARS)}…`
    : text;
}

/**
 * 命中则返回**原位**短路结果（调用方不再执行该工具），否则返回 `undefined`。
 *
 * 只读判定由调用方给出（`Tool.isReadOnly(args)`）；本函数只负责缓存与次数控制。
 */
export function takeRepeatedRead(
  call: RepeatedReadCall,
  readOnly: boolean,
  cache: RepeatedReadCache
): RepeatedReadShortCircuit | undefined {
  if (!isRepeatableRead(call.name, readOnly)) return undefined;
  const entry = cache.get(cacheKey(call));
  if (!entry) return undefined;
  if (entry.hits >= MAX_REPEATED_READ_REPLAYS) return undefined;
  entry.hits += 1;
  return {
    toolCallId: call.id,
    toolName: call.name,
    result:
      `[未重复执行] 本步骤内已用相同参数调用过 ${call.name}，结果与上次一致，故不再重复执行。` +
      `上次结果预览：${previewOf(entry.result)}。` +
      '完整内容见上文该次调用的结果，请直接基于它继续；若需要不同内容，请更换参数或工具。',
  };
}

/**
 * 工具级入口：先判只读（工具未实现 `isReadOnly` ⇒ 视为写，fail-closed），再查短路。
 *
 * 返回 `readOnly` 供调用方在真实执行后回填缓存（写调用会清空整步缓存）。
 */
export function takeRepeatedReadForTool(
  call: RepeatedReadCall,
  isReadOnly: ((args: Record<string, unknown>) => boolean) | undefined,
  cache: RepeatedReadCache
): {
  readOnly: boolean;
  shortCircuit?: RepeatedReadShortCircuit;
} {
  let readOnly = false;
  try {
    readOnly = typeof isReadOnly === 'function' && isReadOnly(call.arguments);
  } catch {
    // 判定异常 ⇒ 当作写（不短路），由真实执行路径暴露问题
    readOnly = false;
  }
  return { readOnly, shortCircuit: takeRepeatedRead(call, readOnly, cache) };
}

/**
 * 记录一次**真实执行**的只读结果；非只读调用会把本步缓存整体清空。
 *
 * @param error 该次执行的错误（有错误 ⇒ 不入缓存，避免把失败固化成"结论"）
 */
export function rememberRepeatedRead(
  call: RepeatedReadCall,
  readOnly: boolean,
  result: unknown,
  error: string | undefined,
  cache: RepeatedReadCache
): void {
  if (!isRepeatableRead(call.name, readOnly)) {
    // 写 / 命令类调用 ⇒ 世界可能已改变，之前的读结果不再可信
    cache.clear();
    return;
  }
  if (error) return;
  cache.set(cacheKey(call), { result, hits: 0 });
}
