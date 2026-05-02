/**
 * LSP Zod Schema验证模块
 * 使用Zod定义LSP工具的输入Schema，实现运行时Schema验证
 * 包含缓存机制以提高性能
 */

import { z } from 'zod';
import type { Position, Range, Location, Diagnostic, CompletionItem } from './types';

/**
 * 缓存配置
 */
const CACHE_SIZE = 1000;
const CACHE_TTL = 60000; // 60秒

/**
 * 缓存条目类型
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * 验证结果缓存
 */
const validationCache = new Map<string, CacheEntry<boolean>>();
const requestCache = new Map<string, CacheEntry<{ valid: boolean; errors?: string[] }>>();

/**
 * 生成缓存键
 */
function generateCacheKey(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/**
 * 获取缓存值
 */
function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.value;
  }
  if (entry) {
    cache.delete(key);
  }
  return undefined;
}

/**
 * 设置缓存值
 */
function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (cache.size >= CACHE_SIZE) {
    // LRU缓存淘汰策略：删除最旧的条目
    let oldestKey: string | undefined;
    let oldestTimestamp = Date.now();
    for (const [k, v] of cache) {
      if (v.timestamp < oldestTimestamp) {
        oldestTimestamp = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, { value, timestamp: Date.now() });
}

/**
 * 清空缓存
 */
export function clearValidationCache(): void {
  validationCache.clear();
  requestCache.clear();
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): { validationCacheSize: number; requestCacheSize: number } {
  return {
    validationCacheSize: validationCache.size,
    requestCacheSize: requestCache.size,
  };
}

/**
 * Position Schema
 */
export const PositionSchema = z.object({
  line: z.number().int().min(0),
  character: z.number().int().min(0),
});

/**
 * Range Schema
 */
export const RangeSchema = z.object({
  start: PositionSchema,
  end: PositionSchema,
});

/**
 * Location Schema
 */
export const LocationSchema = z.object({
  uri: z.string().url(),
  range: RangeSchema,
});

/**
 * Diagnostic Schema
 */
export const DiagnosticSchema = z.object({
  range: RangeSchema,
  severity: z.number().int().min(1).max(4).optional(),
  code: z.union([z.string(), z.number()]).optional(),
  source: z.string().optional(),
  message: z.string(),
});

/**
 * CompletionItem Schema
 */
export const CompletionItemSchema = z.object({
  label: z.string(),
  kind: z.number().int().min(1).max(25).optional(),
  detail: z.string().optional(),
  documentation: z.union([z.string(), z.object({ kind: z.string(), value: z.string() })]).optional(),
  insertText: z.string().optional(),
  insertTextFormat: z.number().int().min(1).max(2).optional(),
  filterText: z.string().optional(),
  sortText: z.string().optional(),
});

/**
 * 文档操作请求Schema
 */
export const DocumentOperationRequestSchema = z.object({
  uri: z.string().url(),
  position: PositionSchema,
});

/**
 * 格式化请求Schema
 */
export const FormattingRequestSchema = z.object({
  uri: z.string().url(),
  options: z.object({
    tabSize: z.number().int().min(1),
    insertSpaces: z.boolean(),
  }),
});

/**
 * 重命名请求Schema
 */
export const RenameRequestSchema = z.object({
  uri: z.string().url(),
  position: PositionSchema,
  newName: z.string().min(1),
});

/**
 * 代码操作请求Schema
 */
export const CodeActionRequestSchema = z.object({
  uri: z.string().url(),
  position: PositionSchema,
  context: z.object({
    diagnostics: z.array(DiagnosticSchema),
  }),
});

/**
 * 验证Position（带缓存）
 */
export function validatePosition(position: unknown): position is Position {
  const key = `position-${generateCacheKey(position)}`;
  const cached = getCachedValue(validationCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = PositionSchema.safeParse(position);
  setCachedValue(validationCache, key, result.success);
  return result.success;
}

/**
 * 验证Range（带缓存）
 */
export function validateRange(range: unknown): range is Range {
  const key = `range-${generateCacheKey(range)}`;
  const cached = getCachedValue(validationCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = RangeSchema.safeParse(range);
  setCachedValue(validationCache, key, result.success);
  return result.success;
}

/**
 * 验证Location（带缓存）
 */
export function validateLocation(location: unknown): location is Location {
  const key = `location-${generateCacheKey(location)}`;
  const cached = getCachedValue(validationCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = LocationSchema.safeParse(location);
  setCachedValue(validationCache, key, result.success);
  return result.success;
}

/**
 * 验证Diagnostic（带缓存）
 */
export function validateDiagnostic(diagnostic: unknown): diagnostic is Diagnostic {
  const key = `diagnostic-${generateCacheKey(diagnostic)}`;
  const cached = getCachedValue(validationCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = DiagnosticSchema.safeParse(diagnostic);
  setCachedValue(validationCache, key, result.success);
  return result.success;
}

/**
 * 验证CompletionItem（带缓存）
 */
export function validateCompletionItem(item: unknown): item is CompletionItem {
  const key = `completion-${generateCacheKey(item)}`;
  const cached = getCachedValue(validationCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = CompletionItemSchema.safeParse(item);
  setCachedValue(validationCache, key, result.success);
  return result.success;
}

/**
 * 验证文档操作请求（带缓存）
 */
export function validateDocumentOperationRequest(request: unknown): { valid: boolean; errors?: string[] } {
  const key = `doc-op-${generateCacheKey(request)}`;
  const cached = getCachedValue(requestCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = DocumentOperationRequestSchema.safeParse(request);
  const response = result.success
    ? { valid: true }
    : {
        valid: false,
        errors: result.error.errors.map(e => e.message),
      };
  setCachedValue(requestCache, key, response);
  return response;
}

/**
 * 验证格式化请求（带缓存）
 */
export function validateFormattingRequest(request: unknown): { valid: boolean; errors?: string[] } {
  const key = `format-${generateCacheKey(request)}`;
  const cached = getCachedValue(requestCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = FormattingRequestSchema.safeParse(request);
  const response = result.success
    ? { valid: true }
    : {
        valid: false,
        errors: result.error.errors.map(e => e.message),
      };
  setCachedValue(requestCache, key, response);
  return response;
}

/**
 * 验证重命名请求（带缓存）
 */
export function validateRenameRequest(request: unknown): { valid: boolean; errors?: string[] } {
  const key = `rename-${generateCacheKey(request)}`;
  const cached = getCachedValue(requestCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = RenameRequestSchema.safeParse(request);
  const response = result.success
    ? { valid: true }
    : {
        valid: false,
        errors: result.error.errors.map(e => e.message),
      };
  setCachedValue(requestCache, key, response);
  return response;
}

/**
 * 验证代码操作请求（带缓存）
 */
export function validateCodeActionRequest(request: unknown): { valid: boolean; errors?: string[] } {
  const key = `code-action-${generateCacheKey(request)}`;
  const cached = getCachedValue(requestCache, key);
  if (cached !== undefined) {
    return cached;
  }
  const result = CodeActionRequestSchema.safeParse(request);
  const response = result.success
    ? { valid: true }
    : {
        valid: false,
        errors: result.error.errors.map(e => e.message),
      };
  setCachedValue(requestCache, key, response);
  return response;
}