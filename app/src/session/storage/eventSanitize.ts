/**
 * 事件无损 JSON 校验 + 深冻结（D1，2026-08-24）
 *
 * 对齐 deepseek-harness `snapshotJsonValue` + `deepFreeze`（对标分析 D1）。
 *
 * 设计决策（见 dev_docs/20260824/D1-事件不可变-设计方案-20260824.md）：
 *   - 本项目事件不外发第三方，故采用"验证 + 冻结"而非"验证 + 复制"——
 *     省一次深拷贝（deepseek-harness 因事件可被插件订阅外发才需快照复制）。
 *   - 冻结边界：EventLogStorage.append 入口（所有事件写盘唯一权威）。
 *   - 幂等：已冻结对象直接返回（避免二次遍历）。
 *   - 校验语义与 JSON.stringify 对齐：拒绝 BigInt/function/symbol/undefined/
 *     NaN/Infinity/-0/循环引用/稀疏数组/Map/Set/Date/class 实例。
 */

import type { LiriEvent } from '@modules/chat/types/events';

/** 校验结果 */
export interface EventSanitizeResult {
  ok: boolean;
  /** 校验失败原因（ok=false 时，含具体失败路径） */
  reason?: string;
  /** 冻结后事件（ok=true 时） */
  event?: LiriEvent;
}

/** 校验失败时抛出的内部错误（携带失败路径） */
class JsonValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'JsonValidationError';
  }
}

/** 递归无损 JSON 校验一个值（不修改原值）；失败抛 JsonValidationError（含路径） */
function assertJsonValue(value: unknown, path: string): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    // JSON 数字：有限；-0 会被 JSON.stringify 归一为 0（语义丢失）→ 拒绝
    if (!Number.isFinite(value)) {
      throw new JsonValidationError(path, '非有限数值（NaN/Infinity）');
    }
    if (Object.is(value, -0)) {
      throw new JsonValidationError(
        path,
        '-0 会被 JSON.stringify 归一为 0（语义丢失）'
      );
    }
    return;
  }
  if (t === 'object') {
    const obj = value as object;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (!(i in obj)) {
          throw new JsonValidationError(path, `稀疏数组（空洞位于索引 ${i}）`);
        }
        assertJsonValue((obj as unknown[])[i], `${path}[${i}]`);
      }
      return;
    }
    // 数组已在上面处理；此处仅普通对象（原型为 Object.prototype 或 null）
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new JsonValidationError(
        path,
        `非普通对象（${proto?.constructor?.name ?? 'null-prototype'}）`
      );
    }
    for (const key of Object.keys(obj)) {
      const child = (obj as Record<string, unknown>)[key];
      assertJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  // undefined / function / symbol / bigint → 非 JSON
  throw new JsonValidationError(path, `${t} 类型不可 JSON 序列化`);
}

/** 深冻结一个对象（迭代实现，避免递归爆栈；幂等） */
export function deepFreeze<T extends object>(value: T): T {
  if (Object.isFrozen(value)) return value;
  const stack: object[] = [value];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (Object.isFrozen(current)) continue;
    Object.freeze(current);
    for (const key of Object.keys(current)) {
      const child = (current as Record<string, unknown>)[key];
      if (
        child !== null &&
        typeof child === 'object' &&
        !Object.isFrozen(child)
      ) {
        stack.push(child as object);
      }
    }
  }
  return value;
}

/**
 * 单遍校验 + 冻结事件
 *
 * - 校验失败 → { ok: false, reason }（不写盘，对齐 append 不抛错契约）
 * - 校验通过 → 深冻结 event（含 data 递归），返回冻结后事件
 * - 幂等：已冻结事件直接返回，无二次开销
 */
export function sanitizeEvent(event: LiriEvent): EventSanitizeResult {
  // 幂等短路：事件与其 data 均已冻结 → 直接返回（热点优化，见方案 §4.3.1）
  if (Object.isFrozen(event) && Object.isFrozen(event.data)) {
    return { ok: true, event };
  }
  // 先校验（不修改原值），通过后再冻结——失败时不产生半冻结对象
  try {
    assertJsonValue(event, 'event');
  } catch (e) {
    const message = e instanceof JsonValidationError ? e.message : String(e);
    return { ok: false, reason: `事件载荷含非 JSON 值（${message}）` };
  }
  return { ok: true, event: deepFreeze(event) };
}
