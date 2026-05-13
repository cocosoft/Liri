/**
 * 增强的类型定义
 * 包含常用类型别名、接口定义、类型工具等
 */

/**
 * 基础类型别名
 */
export type Primitive = string | number | boolean | null | undefined;

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export type Recordable<T = unknown> = Record<string, T>;

export type Arrayable<T> = T | T[];

export type Constructor<T = unknown> = new (...args: unknown[]) => T;

/**
 * 函数类型别名
 */
export type AsyncFunction<T = unknown, Args extends unknown[] = unknown[]> = (
  ...args: Args
) => Promise<T>;

export type SyncFunction<T = unknown, Args extends unknown[] = unknown[]> = (
  ...args: Args
) => T;

export type VoidFunction = () => void;

export type AsyncVoidFunction = () => Promise<void>;

/**
 * 回调类型别名
 */
export type Callback<T = unknown> = (error: Error | null, result?: T) => void;

export type Predicate<T = unknown> = (value: T) => boolean;

export type Consumer<T = unknown> = (value: T) => void;

export type Supplier<T = unknown> = () => T;

export type Mapper<T = unknown, R = unknown> = (value: T) => R;

export type Reducer<T = unknown, R = unknown> = (
  accumulator: R,
  value: T,
  index?: number
) => R;

/**
 * Promise类型别名
 */
export type PromiseOr<T> = T | Promise<T>;

export type ResolvedPromise<T> =
  Promise<T> extends Promise<infer R> ? R : never;

/**
 * 结果类型
 */
export interface Result<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
}

export type ResultOk<T> = { success: true; data: T };

export type ResultErr<E = Error> = { success: false; error: E };

export function ok<T>(data: T): ResultOk<T> {
  return { success: true, data };
}

export function err<E = Error>(error: E): ResultErr<E> {
  return { success: false, error };
}

/**
 * 分页类型
 */
export interface Page<T = unknown> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function createPage<T>(
  items: T[],
  total: number,
  options: PaginationOptions = {}
): Page<T> {
  const { page = 1, pageSize = 10 } = options;
  const totalPages = Math.ceil(total / pageSize);
  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * 键值对类型
 */
export interface KeyValuePair<K = string, V = unknown> {
  key: K;
  value: V;
}

/**
 * 选项类型
 */
export interface Option<T = unknown> {
  label: string;
  value: T;
  disabled?: boolean;
  description?: string;
}

/**
 * 树节点类型
 */
export interface TreeNode<T = unknown> {
  id: string | number;
  label: string;
  data?: T;
  children?: TreeNode<T>[];
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  icon?: string;
}

/**
 * 事件类型
 */
export interface Event<T = unknown> {
  type: string;
  payload?: T;
  timestamp: number;
  source?: string;
}

export interface EventEmitter {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * 配置类型
 */
export interface ConfigOptions {
  path?: string;
  watch?: boolean;
  defaults?: Record<string, unknown>;
  validate?: (config: Record<string, unknown>) => boolean;
  transform?: (config: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * 验证规则类型
 */
export interface ValidationRule {
  type:
    | 'required'
    | 'min'
    | 'max'
    | 'minLength'
    | 'maxLength'
    | 'pattern'
    | 'custom';
  message?: string;
  value?: unknown;
  validator?: (value: unknown) => boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 定时任务类型
 */
export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  handler: () => void | Promise<void>;
  enabled?: boolean;
  running?: boolean;
  lastRun?: number;
  nextRun?: number;
  runCount?: number;
}

/**
 * 日志条目类型
 */
export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  context?: Record<string, unknown>;
  error?: Error;
}

/**
 * 性能指标类型
 */
export interface Metrics {
  name: string;
  value: number;
  unit?: string;
  timestamp?: number;
  tags?: Record<string, string>;
}

export interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

export interface CpuMetrics {
  usage: number;
  user: number;
  system: number;
}

/**
 * 健康检查类型
 */
export interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  message?: string;
  lastCheck?: number;
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheck[];
  timestamp: number;
  uptime: number;
}

/**
 * 速率限制类型
 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  statusCode?: number;
}

export interface RateLimitInfo {
  remaining: number;
  reset: number;
  total: number;
}

/**
 * 缓存类型
 */
export interface CacheOptions {
  ttl?: number;
  namespace?: string;
  compress?: boolean;
  serializer?: 'json' | 'msgpack' | 'protobuf';
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  expiresAt?: number;
  createdAt: number;
  hitCount?: number;
}

/**
 * 连接类型
 */
export interface ConnectionOptions {
  host?: string;
  port?: number;
  secure?: boolean;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  error?: Error;
  lastConnected?: number;
  lastDisconnected?: number;
}

/**
 * Webhook类型
 */
export interface WebhookConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  retry?: boolean;
  timeout?: number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  payload: unknown;
  attempts?: number;
  maxAttempts?: number;
  createdAt: number;
  lastAttempt?: number;
}

/**
 * 监控告警类型
 */
export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  source: string;
  timestamp: number;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolved?: boolean;
  resolvedAt?: number;
}

/**
 * 批量操作类型
 */
export interface BatchOperation<T = unknown> {
  id: string;
  type: 'create' | 'update' | 'delete';
  items: T[];
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  results?: BatchResult[];
  error?: Error;
  startedAt?: number;
  completedAt?: number;
}

export interface BatchResult {
  item: unknown;
  success: boolean;
  error?: string;
}

/**
 * 锁定类型
 */
export interface LockOptions {
  ttl?: number;
  retry?: boolean;
  retryInterval?: number;
  retryAttempts?: number;
}

export interface Lock {
  key: string;
  token: string;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * 流类型
 */
export interface StreamOptions {
  highWaterMark?: number;
  encoding?: string;
  objectMode?: boolean;
}

export interface StreamStats {
  bytesRead: number;
  bytesWritten: number;
  readCount: number;
  writeCount: number;
}

/**
 * 观察者类型
 */
export interface Observer<T = unknown> {
  update(data: T): void;
}

export interface Observable<T = unknown> {
  subscribe(observer: Observer<T>): void;
  unsubscribe(observer: Observer<T>): void;
  notify(data: T): void;
}
