//
/**
 * 代码性能优化工具
 * 提供常用的代码性能优化函数和工具
 */

import { logForDebugging } from '../utils/debug.js';
import { slowLogging } from './SlowOperations.js';

/**
 * 节流函数
 * 限制函数在一定时间内只执行一次
 * @param fn 要执行的函数
 * @param delay 延迟时间（毫秒）
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
}

/**
 * 防抖函数
 * 在一定时间内多次调用只执行最后一次
 * @param fn 要执行的函数
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      fn(...args);
      timeout = null;
    }, delay);
  };
}

/**
 * 记忆函数
 * 缓存函数的计算结果，避免重复计算
 * @param fn 要记忆的函数
 * @returns 记忆后的函数
 */
export function memoize<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => ReturnType<T> {
  const cache = new Map<string, ReturnType<T>>();
  return (...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * 批量处理函数
 * 将多个操作批量处理，减少重复计算
 * @param items 要处理的项目数组
 * @param batchSize 批处理大小
 * @param processor 处理函数
 * @returns 处理结果
 */
export async function batchProcess<T, R>(items: T[], batchSize: number, processor: (batch: T[]) => Promise<R[]>): Promise<R[]> {
  const result: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResult = await processor(batch);
    result.push(...batchResult);
  }
  return result;
}

/**
 * 延迟执行函数
 * 在指定时间后执行函数
 * @param fn 要执行的函数
 * @param delay 延迟时间（毫秒）
 * @returns 定时器ID
 */
export function delay<T extends (...args: any[]) => any>(fn: T, delay: number, ...args: Parameters<T>): NodeJS.Timeout {
  return setTimeout(() => fn(...args), delay);
}

/**
 * 并行执行函数
 * 并行执行多个异步函数
 * @param tasks 要执行的任务数组
 * @returns 任务结果数组
 */
export async function parallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  return Promise.all(tasks.map(task => task()));
}

/**
 * 串行执行函数
 * 串行执行多个异步函数
 * @param tasks 要执行的任务数组
 * @returns 任务结果数组
 */
export async function series<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const result: T[] = [];
  for (const task of tasks) {
    const res = await task();
    result.push(res);
  }
  return result;
}

/**
 * 超时函数
 * 为异步操作添加超时限制
 * @param promise 要执行的Promise
 * @param timeout 超时时间（毫秒）
 * @param message 超时消息
 * @returns 执行结果
 */
export async function timeout<T>(promise: Promise<T>, timeout: number, message: string = '操作超时'): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(message)), timeout);
  });
  return Promise.race([promise, timeoutPromise]) as Promise<T>;
}

/**
 * 重试函数
 * 当函数执行失败时自动重试
 * @param fn 要执行的函数
 * @param maxRetries 最大重试次数
 * @param delay 重试延迟（毫秒）
 * @returns 执行结果
 */
export async function retry<T>(fn: () => Promise<T>, maxRetries: number = 3, delay: number = 1000): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        logForDebugging(`操作失败，${delay}ms后重试 (${i + 1}/${maxRetries}): ${lastError.message}`, { level: 'warn' });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * 高效的数组去重
 * @param array 要去重的数组
 * @returns 去重后的数组
 */
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

/**
 * 高效的数组查找
 * @param array 要查找的数组
 * @param predicate 查找条件
 * @returns 找到的元素或undefined
 */
export function find<T>(array: T[], predicate: (item: T) => boolean): T | undefined {
  for (const item of array) {
    if (predicate(item)) {
      return item;
    }
  }
  return undefined;
}

/**
 * 高效的数组映射
 * @param array 要映射的数组
 * @param mapper 映射函数
 * @returns 映射后的数组
 */
export function map<T, R>(array: T[], mapper: (item: T, index: number) => R): R[] {
  const result: R[] = new Array(array.length);
  for (let i = 0; i < array.length; i++) {
    result[i] = mapper(array[i], i);
  }
  return result;
}

/**
 * 高效的数组过滤
 * @param array 要过滤的数组
 * @param predicate 过滤条件
 * @returns 过滤后的数组
 */
export function filter<T>(array: T[], predicate: (item: T, index: number) => boolean): T[] {
  const result: T[] = [];
  for (let i = 0; i < array.length; i++) {
    if (predicate(array[i], i)) {
      result.push(array[i]);
    }
  }
  return result;
}

/**
 * 高效的数组归约
 * @param array 要归约的数组
 * @param reducer 归约函数
 * @param initialValue 初始值
 * @returns 归约结果
 */
export function reduce<T, R>(array: T[], reducer: (accumulator: R, currentValue: T, index: number) => R, initialValue: R): R {
  let accumulator = initialValue;
  for (let i = 0; i < array.length; i++) {
    accumulator = reducer(accumulator, array[i], i);
  }
  return accumulator;
}

/**
 * 高效的对象遍历
 * @param obj 要遍历的对象
 * @param callback 回调函数
 */
export function forEachObject<T extends Record<string, any>>(obj: T, callback: (value: T[keyof T], key: keyof T) => void): void {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      callback(obj[key], key);
    }
  }
}

/**
 * 高效的对象复制
 * @param obj 要复制的对象
 * @returns 复制后的对象
 */
export function copyObject<T extends Record<string, any>>(obj: T): T {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      result[key] = obj[key];
    }
  }
  return result as T;
}

/**
 * 高效的对象合并
 * @param target 目标对象
 * @param sources 源对象
 * @returns 合并后的对象
 */
export function mergeObjects<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
  const result: Partial<T> = { ...target };
  for (const source of sources) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        result[key] = source[key];
      }
    }
  }
  return result as T;
}

/**
 * 性能优化的JSON序列化
 * @param data 要序列化的数据
 * @returns JSON字符串
 */
export function optimizedJsonStringify(data: any): string {
  using _ = slowLogging`optimizedJsonStringify(${data})`;
  return JSON.stringify(data);
}

/**
 * 性能优化的JSON解析
 * @param json JSON字符串
 * @returns 解析后的数据
 */
export function optimizedJsonParse(json: string): any {
  using _ = slowLogging`optimizedJsonParse(${json})`;
  return JSON.parse(json);
}

/**
 * 性能优化的结构化克隆
 * @param value 要克隆的值
 * @param options 克隆选项
 * @returns 克隆后的值
 */
export function optimizedClone<T>(value: T, options?: StructuredSerializeOptions): T {
  using _ = slowLogging`optimizedClone(${value})`;
  return structuredClone(value, options);
}
