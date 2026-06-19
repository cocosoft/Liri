/**
 * RuntimeConfigSnapshot 运行时配置快照
 *
 * 对标 OpenClaw runtime-snapshot.ts
 * 管理运行时配置的快照缓存，支持 Hash 指纹、修订号追踪和写入通知监听。
 * 提供确定性 JSON 序列化保证相同配置值产生相同 Hash。
 */

import { createHash } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.DEBUG });

// ─── 类型定义 ─────────────────────────────────

/**
 * 运行时快照刷新处理器
 * 外部模块可通过此接口注册配置刷新回调
 */
export interface RuntimeConfigSnapshotRefreshHandler {
  refresh: (
    params: RuntimeConfigSnapshotRefreshParams
  ) => boolean | Promise<boolean>;
  clearOnRefreshFailure?: () => void;
}

/**
 * 运行时快照刷新参数
 */
export interface RuntimeConfigSnapshotRefreshParams {
  sourceConfig: Record<string, unknown>;
}

/**
 * 运行时快照元数据
 */
export interface RuntimeConfigSnapshotMetadata {
  /** 修订号，每次更新递增 */
  revision: number;
  /** 配置内容的 SHA-256 Hash（Base64URL） */
  fingerprint: string;
  /** 源配置的指纹，用于检测外部修改 */
  sourceFingerprint: string | null;
  /** 快照更新时间戳（毫秒） */
  updatedAtMs: number;
}

/**
 * 运行时配置写入通知
 */
export interface RuntimeConfigWriteNotification {
  /** 配置文件路径 */
  configPath: string;
  /** 源配置 */
  sourceConfig: Record<string, unknown>;
  /** 运行时配置 */
  runtimeConfig: Record<string, unknown>;
  /** 持久化后的 Hash */
  persistedHash: string;
  /** 修订号 */
  revision: number;
  /** 指纹 */
  fingerprint: string;
  /** 源指纹 */
  sourceFingerprint: string | null;
  /** 写入时间戳 */
  writtenAtMs: number;
}

// ─── 模块级状态（单例） ───────────────────────

/** 当前运行时配置快照 */
let runtimeConfigSnapshot: Record<string, unknown> | null = null;

/** 运行时配置的源配置（来自文件持久化） */
let runtimeConfigSourceSnapshot: Record<string, unknown> | null = null;

/** 运行时快照元数据 */
let runtimeConfigSnapshotMetadata: RuntimeConfigSnapshotMetadata | null = null;

/** 修订号计数器 */
let runtimeConfigSnapshotRevision = 0;

/** 刷新处理器 */
let runtimeConfigSnapshotRefreshHandler: RuntimeConfigSnapshotRefreshHandler | null =
  null;

/** 写入监听器集合 */
const runtimeConfigWriteListeners = new Set<
  (event: RuntimeConfigWriteNotification) => void
>();

// ─── 工具函数 ─────────────────────────────────

/**
 * 确定性 JSON 序列化
 * 保证相同配置值总是产生相同字符串
 * 对象键按字典序排列
 */
function stableConfigStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableConfigStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map(
      (key) => `${JSON.stringify(key)}:${stableConfigStringify(record[key])}`
    )
    .join(',')}}`;
}

/**
 * 比较两个运行时快照是否匹配
 */
function configSnapshotsMatch(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  if (left === right) {
    return true;
  }
  try {
    return stableConfigStringify(left) === stableConfigStringify(right);
  } catch {
    return false;
  }
}

/**
 * 计算配置对象的 SHA-256 指纹（Base64URL）
 * @param value 配置对象
 * @returns Base64URL 编码的 Hash 字符串
 */
export function hashRuntimeConfigValue(value: Record<string, unknown>): string {
  return createHash('sha256')
    .update(stableConfigStringify(value))
    .digest('base64url');
}

/**
 * 创建快照元数据
 */
function createRuntimeConfigSnapshotMetadata(
  config: Record<string, unknown>,
  sourceConfig?: Record<string, unknown>
): RuntimeConfigSnapshotMetadata {
  runtimeConfigSnapshotRevision += 1;
  return {
    revision: runtimeConfigSnapshotRevision,
    fingerprint: hashRuntimeConfigValue(config),
    sourceFingerprint: sourceConfig
      ? hashRuntimeConfigValue(sourceConfig)
      : null,
    updatedAtMs: Date.now(),
  };
}

// ─── 核心 API ─────────────────────────────────

/**
 * 设置运行时配置快照
 * @param config 运行时配置对象
 * @param sourceConfig 可选的源配置，用于外部修改检测
 */
export function setRuntimeConfigSnapshot(
  config: Record<string, unknown>,
  sourceConfig?: Record<string, unknown>
): void {
  runtimeConfigSnapshot = config;
  runtimeConfigSourceSnapshot = sourceConfig ?? null;
  runtimeConfigSnapshotMetadata = createRuntimeConfigSnapshotMetadata(
    config,
    sourceConfig
  );
}

/**
 * 获取当前运行时配置快照
 * @returns 运行时配置对象，未设置时返回 null
 */
export function getRuntimeConfigSnapshot(): Record<string, unknown> | null {
  return runtimeConfigSnapshot;
}

/**
 * 获取当前运行时配置的源配置
 * @returns 源配置对象，未设置时返回 null
 */
export function getRuntimeConfigSourceSnapshot(): Record<
  string,
  unknown
> | null {
  return runtimeConfigSourceSnapshot;
}

/**
 * 获取运行时快照元数据
 * @returns 快照元数据，未设置时返回 null
 */
export function getRuntimeConfigSnapshotMetadata(): RuntimeConfigSnapshotMetadata | null {
  return runtimeConfigSnapshotMetadata;
}

/**
 * 清除运行时配置快照
 * 重置所有模块级状态
 */
export function clearRuntimeConfigSnapshot(): void {
  runtimeConfigSnapshot = null;
  runtimeConfigSourceSnapshot = null;
  runtimeConfigSnapshotMetadata = null;
  runtimeConfigSnapshotRevision = 0;
}

/**
 * 解析运行时配置缓存键
 * 优先级：如果配置对象与快照引用相同，使用带修订号的快速键
 * @param config 配置对象
 * @returns 缓存键字符串
 */
export function resolveRuntimeConfigCacheKey(
  config: Record<string, unknown>
): string {
  const metadata = runtimeConfigSnapshotMetadata;
  if (metadata && config === runtimeConfigSnapshot) {
    return `runtime:${metadata.revision}:${metadata.fingerprint}`;
  }
  return `config:${hashRuntimeConfigValue(config)}`;
}

/**
 * 设置运行时快照刷新处理器
 * @param refreshHandler 刷新处理器实例，传入 null 清除
 */
export function setRuntimeConfigSnapshotRefreshHandler(
  refreshHandler: RuntimeConfigSnapshotRefreshHandler | null
): void {
  runtimeConfigSnapshotRefreshHandler = refreshHandler;
}

/**
 * 获取当前快照刷新处理器
 * @returns 刷新处理器或 null
 */
export function getRuntimeConfigSnapshotRefreshHandler(): RuntimeConfigSnapshotRefreshHandler | null {
  return runtimeConfigSnapshotRefreshHandler;
}

/**
 * 注册运行时配置写入监听器
 * @param listener 监听回调
 * @returns 取消注册的函数
 */
export function registerRuntimeConfigWriteListener(
  listener: (event: RuntimeConfigWriteNotification) => void
): () => void {
  runtimeConfigWriteListeners.add(listener);
  return () => {
    runtimeConfigWriteListeners.delete(listener);
  };
}

/**
 * 通知所有运行时配置写入监听器
 * 遍历监听器列表并执行，异常隔离不阻断
 */
export function notifyRuntimeConfigWriteListeners(
  event: RuntimeConfigWriteNotification
): void {
  for (const listener of runtimeConfigWriteListeners) {
    try {
      listener(event);
    } catch (error) {
      logger.warn('运行时配置写入监听器执行异常', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * 创建运行时配置写入通知对象
 */
export function createRuntimeConfigWriteNotification(params: {
  configPath: string;
  sourceConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  persistedHash: string;
  writtenAtMs?: number;
}): RuntimeConfigWriteNotification {
  const metadata =
    params.runtimeConfig === runtimeConfigSnapshot &&
    runtimeConfigSnapshotMetadata
      ? runtimeConfigSnapshotMetadata
      : {
          revision: runtimeConfigSnapshotRevision,
          fingerprint: hashRuntimeConfigValue(params.runtimeConfig),
          sourceFingerprint: hashRuntimeConfigValue(params.sourceConfig),
          updatedAtMs: Date.now(),
        };

  return {
    configPath: params.configPath,
    sourceConfig: params.sourceConfig,
    runtimeConfig: params.runtimeConfig,
    persistedHash: params.persistedHash,
    revision: metadata.revision,
    fingerprint: metadata.fingerprint,
    sourceFingerprint: metadata.sourceFingerprint,
    writtenAtMs: params.writtenAtMs ?? Date.now(),
  };
}

/**
 * 加载固定运行时配置
 * 如果有快照则直接返回快照，否则执行加载函数并生成新快照
 * @param loadFresh 加载新配置的函数
 * @returns 运行时配置
 */
export function loadPinnedRuntimeConfig(
  loadFresh: () => Record<string, unknown>
): Record<string, unknown> {
  if (runtimeConfigSnapshot) {
    return runtimeConfigSnapshot;
  }
  const config = loadFresh();
  setRuntimeConfigSnapshot(config);
  return getRuntimeConfigSnapshot() ?? config;
}

/**
 * 选择适用的运行时配置
 * 当输入配置与源配置匹配时使用快照，否则使用输入配置
 */
export function selectApplicableRuntimeConfig(params: {
  inputConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown> | null;
  runtimeSourceConfig?: Record<string, unknown> | null;
}): Record<string, unknown> | undefined {
  const runtimeConfig = params.runtimeConfig ?? null;
  if (!runtimeConfig) {
    return params.inputConfig;
  }
  const inputConfig = params.inputConfig;
  if (!inputConfig) {
    return runtimeConfig;
  }
  if (inputConfig === runtimeConfig) {
    return inputConfig;
  }
  const runtimeSourceConfig = params.runtimeSourceConfig ?? null;
  if (!runtimeSourceConfig) {
    return runtimeConfig;
  }
  if (configSnapshotsMatch(inputConfig, runtimeSourceConfig)) {
    return runtimeConfig;
  }
  return inputConfig;
}
