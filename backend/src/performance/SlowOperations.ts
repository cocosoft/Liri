//
/**
 * 慢操作检测系统
 * 用于检测和记录执行时间超过阈值的操作
 *
 * 支持：
 * 1. 慢操作检测和日志记录
 * 2. 阈值配置
 * 3. 不同用户类型的不同阈值
 * 4. 常见操作的包装（JSON序列化/反序列化、结构化克隆等）
 */

import { logForDebugging } from '../utils/debug.js';
import { addSlowOperation } from '../bootstrap/state.js';
import { getPerformanceConfig } from './PerformanceConfig.js';

// 慢操作统计
const slowOperationStats = {
  total: 0,
  byType: new Map<string, number>(),
  byDuration: {
    '0-100ms': 0,
    '100-500ms': 0,
    '500-1000ms': 0,
    '1000+ms': 0,
  },
};

// 模块级重入保护
// logForDebugging 会写入调试文件，可能会再次触发慢操作检测
let isLogging = false;

/**
 * 获取慢操作阈值（毫秒）
 * 支持不同用户类型的不同阈值
 */
export function getSlowOperationThreshold(): number {
  const config = getPerformanceConfig();
  return config.slowOperations.thresholdMs;
}

/**
 * 提取第一个不在此文件中的堆栈帧
 * 仅在操作确实慢时调用 - 永远不会在快速路径上调用
 */
export function callerFrame(stack: string | undefined): string {
  if (!stack) return '';
  for (const line of stack.split('\n')) {
    if (line.includes('SlowOperations')) continue;
    const m = line.match(/([^/\\]+?):(\d+):\d+\)?$/);
    if (m) return ` @ ${m[1]}:${m[2]}`;
  }
  return '';
}

/**
 * 从标记模板参数构建人类可读的描述
 * 仅在操作确实慢时调用 - 永远不会在快速路径上调用
 *
 * args[0] = TemplateStringsArray, args[1..n] = 插值值
 */
function buildDescription(args: IArguments): string {
  const strings = args[0] as TemplateStringsArray;
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i + 1 < args.length) {
      const v = args[i + 1];
      if (Array.isArray(v)) {
        result += `Array[${(v as unknown[]).length}]`;
      } else if (v !== null && typeof v === 'object') {
        result += `Object{${Object.keys(v as Record<string, unknown>).length} keys}`;
      } else if (typeof v === 'string') {
        result += v.length > 80 ? `${v.slice(0, 80)}…` : v;
      } else {
        result += String(v);
      }
    }
  }
  return result;
}

/**
 * 分类慢操作持续时间
 */
function categorizeDuration(duration: number): string {
  if (duration < 100) return '0-100ms';
  if (duration < 500) return '100-500ms';
  if (duration < 1000) return '500-1000ms';
  return '1000+ms';
}

class SlowLogger {
  startTime: number;
  args: IArguments;
  err: Error;
  operationType: string;

  constructor(args: IArguments, operationType?: string) {
    this.startTime = performance.now();
    this.args = args;
    this.operationType = operationType || 'unknown';
    // V8/JSC 在构造时捕获堆栈，但在读取 .stack 时才进行昂贵的字符串格式化
    // 这样可以保持快速路径的性能
    this.err = new Error();
  }

  [Symbol.dispose](): void {
    const duration = performance.now() - this.startTime;
    const threshold = getSlowOperationThreshold();
    
    if (duration > threshold && !isLogging) {
      isLogging = true;
      try {
        const description = buildDescription(this.args) + callerFrame(this.err.stack);
        const durationCategory = categorizeDuration(duration);
        
        // 更新统计信息
        slowOperationStats.total++;
        slowOperationStats.byType.set(this.operationType, (slowOperationStats.byType.get(this.operationType) || 0) + 1);
        slowOperationStats.byDuration[durationCategory as keyof typeof slowOperationStats.byDuration]++;
        
        // 记录详细日志
        logForDebugging(
          `[慢操作检测] ${description} (${duration.toFixed(1)}ms) [类型: ${this.operationType}] [阈值: ${threshold}ms]`
        );
        
        addSlowOperation(description, duration);
      } finally {
        isLogging = false;
      }
    }
  }
}

const NOOP_LOGGER: Disposable = { [Symbol.dispose]() {} };

// 必须是常规函数（不是箭头函数）才能访问 `arguments`
function slowLoggingImpl(
  _strings: TemplateStringsArray,
  ..._values: unknown[]
): SlowLogger {
  // eslint-disable-next-line prefer-rest-params
  return new SlowLogger(arguments);
}

/**
 * 慢操作日志记录的标记模板
 *
 * 用法：
 * using _ = slowLogging`structuredClone(${value})`
 * const result = structuredClone(value)
 */
export const slowLogging: {
  (strings: TemplateStringsArray, ...values: unknown[]): Disposable
} = slowLoggingImpl;

/**
 * 带类型的慢操作日志记录
 *
 * 用法：
 * using _ = slowLoggingWithType('database', `query(${query})`)
 * const result = await db.query(query)
 */
export function slowLoggingWithType(type: string, strings: string, ...values: unknown[]): Disposable {
  const args = [strings, ...values] as unknown as IArguments;
  return new SlowLogger(args, type);
}

// --- 包装操作 ---

/**
 * 包装的 JSON.stringify，带有慢操作日志记录
 * 使用此函数代替直接使用 JSON.stringify 来检测性能问题
 *
 * @example
 * import { jsonStringify } from './SlowOperations.js'
 * const json = jsonStringify(data)
 * const prettyJson = jsonStringify(data, null, 2)
 */
export function jsonStringify(
  value: unknown,
  replacer?: (this: unknown, key: string, value: unknown) => unknown,
  space?: string | number,
): string
export function jsonStringify(
  value: unknown,
  replacer?: (number | string)[] | null,
  space?: string | number,
): string
export function jsonStringify(
  value: unknown,
  replacer?:
    | ((this: unknown, key: string, value: unknown) => unknown)
    | (number | string)[]
    | null,
  space?: string | number,
): string {
  using _ = slowLoggingWithType('json', `JSON.stringify(${value})`);
  return JSON.stringify(
    value,
    replacer as Parameters<typeof JSON.stringify>[1],
    space,
  );
}

/**
 * 包装的 JSON.parse，带有慢操作日志记录
 * 使用此函数代替直接使用 JSON.parse 来检测性能问题
 *
 * @example
 * import { jsonParse } from './SlowOperations.js'
 * const data = jsonParse(jsonString)
 */
export const jsonParse: typeof JSON.parse = (text, reviver) => {
  using _ = slowLoggingWithType('json', `JSON.parse(${text})`);
  // V8 在传递第二个参数时会对 JSON.parse 进行去优化，即使是 undefined
  // 显式分支，使常见（无 reviver）路径保持在快速路径上
  return typeof reviver === 'undefined'
    ? JSON.parse(text)
    : JSON.parse(text, reviver);
};

/**
 * 包装的 structuredClone，带有慢操作日志记录
 * 使用此函数代替直接使用 structuredClone 来检测性能问题
 *
 * @example
 * import { clone } from './SlowOperations.js'
 * const copy = clone(originalObject)
 */
export function clone<T>(value: T, options?: StructuredSerializeOptions): T {
  using _ = slowLoggingWithType('clone', `structuredClone(${value})`);
  return structuredClone(value, options);
}

/**
 * 包装的 setTimeout，带有慢操作日志记录
 * 使用此函数代替直接使用 setTimeout 来检测性能问题
 *
 * @example
 * import { setTimeoutWithLogging } from './SlowOperations.js'
 * setTimeoutWithLogging(() => {
 *   // 执行操作
 * }, 1000, '操作描述')
 */
export function setTimeoutWithLogging(
  callback: (...args: unknown[]) => void,
  delay: number,
  description: string,
  ...args: unknown[]
): NodeJS.Timeout {
  using _ = slowLoggingWithType('timeout', `setTimeout(${description}, ${delay}ms)`);
  return setTimeout(callback, delay, ...args);
}

/**
 * 包装的 setInterval，带有慢操作日志记录
 * 使用此函数代替直接使用 setInterval 来检测性能问题
 *
 * @example
 * import { setIntervalWithLogging } from './SlowOperations.js'
 * setIntervalWithLogging(() => {
 *   // 执行操作
 * }, 1000, '操作描述')
 */
export function setIntervalWithLogging(
  callback: (...args: unknown[]) => void,
  delay: number,
  description: string,
  ...args: unknown[]
): NodeJS.Timeout {
  using _ = slowLoggingWithType('interval', `setInterval(${description}, ${delay}ms)`);
  return setInterval(callback, delay, ...args);
}

/**
 * 包装的 fetch，带有慢操作日志记录
 * 使用此函数代替直接使用 fetch 来检测性能问题
 *
 * @example
 * import { fetchWithLogging } from './SlowOperations.js'
 * const response = await fetchWithLogging('https://api.example.com')
 */
export async function fetchWithLogging(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  using _ = slowLoggingWithType('network', `fetch(${input})`);
  return fetch(input, init);
}

/**
 * 包装的文件操作，带有慢操作日志记录
 *
 * @example
 * import { fsWithLogging } from './SlowOperations.js'
 * const data = await fsWithLogging.readFile('file.txt', 'utf8')
 */
export const fsWithLogging = {
  readFile: async (path: string, options?: any) => {
    using _ = slowLoggingWithType('fs', `readFile(${path})`);
    const fs = await import('fs/promises');
    return fs.readFile(path, options);
  },
  writeFile: async (path: string, data: any, options?: any) => {
    using _ = slowLoggingWithType('fs', `writeFile(${path})`);
    const fs = await import('fs/promises');
    return fs.writeFile(path, data, options);
  },
  readdir: async (path: string, options?: any) => {
    using _ = slowLoggingWithType('fs', `readdir(${path})`);
    const fs = await import('fs/promises');
    return fs.readdir(path, options);
  },
};

/**
 * 获取慢操作统计信息
 */
export function getSlowOperationStats() {
  return {
    total: slowOperationStats.total,
    byType: Object.fromEntries(slowOperationStats.byType),
    byDuration: { ...slowOperationStats.byDuration },
  };
}

/**
 * 重置慢操作统计信息
 */
export function resetSlowOperationStats() {
  slowOperationStats.total = 0;
  slowOperationStats.byType.clear();
  slowOperationStats.byDuration = {
    '0-100ms': 0,
    '100-500ms': 0,
    '500-1000ms': 0,
    '1000+ms': 0,
  };
}

/**
 * 执行带慢操作检测的函数
 *
 * @example
 * import { withSlowOperationDetection } from './SlowOperations.js'
 * const result = await withSlowOperationDetection('database', async () => {
 *   return await db.query('SELECT * FROM users');
 * });
 */
export async function withSlowOperationDetection<T>(
  operationType: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - startTime;
    const threshold = getSlowOperationThreshold();
    
    if (duration > threshold && !isLogging) {
      isLogging = true;
      try {
        const description = `Function execution [${operationType}]`;
        const durationCategory = categorizeDuration(duration);
        
        // 更新统计信息
        slowOperationStats.total++;
        slowOperationStats.byType.set(operationType, (slowOperationStats.byType.get(operationType) || 0) + 1);
        slowOperationStats.byDuration[durationCategory as keyof typeof slowOperationStats.byDuration]++;
        
        // 记录详细日志
        logForDebugging(
          `[慢操作检测] ${description} (${duration.toFixed(1)}ms) [类型: ${operationType}] [阈值: ${threshold}ms]`
        );
        
        addSlowOperation(description, duration);
      } finally {
        isLogging = false;
      }
    }
  }
}

