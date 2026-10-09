import { getLogger } from '../monitoring/logs/Logger';
// C1（2026-10-09）：统一 ID 熵源定义在 **core**（全层可用，含 core 自身）；此处**再导出**
import { randomIdSuffix } from '../core/ids';

export { randomIdSuffix };

const logger = getLogger('utils:common');

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 取**更完整**的正文（2026-09-22 新增）。
 *
 * 背景（真机实证，会话 `session_mub9t9o0h7x2i9ac6rj`）：流式答复的 `content` 常只累积到
 * **工具调用前的前导短桩**（实测 120 字符），而完整正文落在 `blocks[].content`（实测 2758 字符）
 * 或事件聚合结果里。用"**非空**即采用"会把短桩当成该轮完整答复 ⇒ 模型在下一轮
 * "不知道自己写过什么"⇒ **从头重写**（同一开场重复落盘、上下文膨胀、旧框架残留复读）。
 *
 * ⇒ 判据必须是**长度**，不是"是否非空"。同一规则在**写路径**与**读路径**各有一处调用，
 * 故收敛到此处单点实现（CS01），避免两处口径漂移。
 *
 * @param primary 主来源（流式 content / 投影 content）
 * @param fallback 备来源（blocks 正文 / 事件聚合 content）
 */
export function pickMoreCompleteContent(
  primary: string,
  fallback: string
): string {
  if (fallback.trim().length > primary.trim().length) return fallback;
  return primary.trim().length > 0 ? primary : fallback;
}

export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = deepClone(val);
  }
  return result as T;
}

export function deepMerge(
  ...objects: Record<string, unknown>[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      const existing = result[key];
      if (
        existing !== undefined &&
        typeof existing === 'object' &&
        !Array.isArray(existing) &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        result[key] = deepMerge(
          existing as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 统一 ID 熵源（C1，2026-10-09）
 *
 * 定义见 `core/ids.ts`（本文件顶部再导出，供既有消费者零改动使用）。
 */
export function generateId(prefix: string = 'id'): string {
  // C1（2026-10-09）：熵源改为 crypto（保持 `prefix_timestamp_suffix` 形态不变）
  // R1（2026-10-09）：后缀位宽 6 → **10 hex（40 bit）** —— 原 6 位（≈1670 万空间）在批量
  // 生成下碰撞概率可观（2000 个 ≈ 12%，见台账 L-6）。身份类 ID 的后缀**不得低于 10 位**。
  return `${prefix}_${Date.now()}_${randomIdSuffix(10)}`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    logger.warning('JSON 解析失败，使用默认值', {
      text: text.substring(0, 100),
    });
    return fallback;
  }
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

// ─── 独立便捷函数（2026-09-30 下沉 core 侧，此处同名转出 ⇒ 对外 API 不变）─────
// 下沉原因：core 侧 `core/Coordinator` 直接引用构成 core → infra 倒挂（A 类台账）。

export { lazySingleton } from '../core/lazySingleton.js';
