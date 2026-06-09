import { Logger } from '../monitoring/logs/Logger';

const logger = new Logger({ level: 'info' as any });

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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

/**
 * 带重试的函数执行
 * @deprecated 请使用 @modules/utils/withRetry 中的 withRetry / withRetryAsync
 */
export function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 1000, onRetry } = options;
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      fn()
        .then(resolve)
        .catch((error: Error) => {
          if (n >= maxRetries) {
            reject(error);
            return;
          }
          if (onRetry) onRetry(n + 1, error);
          logger.warning(`操作失败，${n + 1}/${maxRetries} 次重试`, {
            error: error.message,
          });
          setTimeout(() => attempt(n + 1), delay);
        });
    };
    attempt(0);
  });
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

/**
 * 创建懒加载单例 — 通过 Proxy 延迟实例化，首次访问属性时才创建
 * @param factory 实例工厂函数
 * @returns Proxy 包装的实例
 */
export function lazySingleton<T extends object>(factory: () => T): T {
  let instance: T | null = null;

  return new Proxy({} as T, {
    get(_, prop: string | symbol, receiver: unknown) {
      if (!instance) instance = factory();
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(_, prop: string | symbol, value: unknown, receiver: unknown) {
      if (!instance) instance = factory();
      return Reflect.set(instance, prop, value, receiver);
    },
    has(_, prop: string | symbol) {
      if (!instance) instance = factory();
      return Reflect.has(instance, prop);
    },
    ownKeys() {
      if (!instance) instance = factory();
      return Reflect.ownKeys(instance);
    },
    getOwnPropertyDescriptor(_, prop: string | symbol) {
      if (!instance) instance = factory();
      return Reflect.getOwnPropertyDescriptor(instance, prop);
    },
  });
}
