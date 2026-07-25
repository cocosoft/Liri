// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * DataSourceConnector — 外部数据源连接器接口
 *
 * 用于从第三方平台（RSS、飞书、Notion 等）自动同步内容到知识库 raw/ 目录。
 * 参考 WeKnora 的 datasource/connector 设计。
 *
 * 使用方式：
 *   实现此接口后，通过 Scheduler 定期调用 sync() 拉取数据。
 */

export interface SyncResult {
  /** 连接器名称 */
  connector: string;
  /** 本次同步新增条目数 */
  added: number;
  /** 本次同步更新条目数 */
  updated: number;
  /** 本次同步失败条目数 */
  failed: number;
  /** 失败详情 */
  errors: Array<{ item: string; error: string }>;
  /** 同步开始时间 */
  startedAt: number;
  /** 同步结束时间 */
  completedAt: number;
}

export interface DataSourceConfig {
  /** 连接器类型标识 */
  type: string;
  /** 是否启用 */
  enabled: boolean;
  /** 同步间隔（毫秒） */
  intervalMs: number;
  /** 连接器特定配置 */
  [key: string]: unknown;
}

export interface DataSourceItem {
  /** 唯一标识 */
  id: string;
  /** 标题 */
  title: string;
  /** 内容 */
  content: string;
  /** 原始 URL */
  url?: string;
  /** 发布时间 */
  publishedAt?: number;
  /** 作者 */
  author?: string;
  /** 标签 */
  tags?: string[];
  /** 原始数据（连接器特定） */
  raw?: unknown;
}

/**
 * 外部数据源连接器接口
 *
 * 每个连接器负责：
 *   1. 从指定数据源拉取内容
 *   2. 转换为统一的 DataSourceItem 格式
 *   3. 去重（基于 id）
 */
export interface DataSourceConnector {
  /** 连接器类型标识 */
  readonly type: string;
  /** 连接器显示名称 */
  readonly displayName: string;

  /** 执行一次同步，返回同步结果 */
  sync(): Promise<SyncResult>;

  /** 验证配置是否有效 */
  validateConfig(
    config: DataSourceConfig
  ): Promise<{ valid: boolean; errors: string[] }>;

  /** 获取上次同步的状态（用于增量同步） */
  getLastSyncState(): Promise<{
    lastSyncAt: number;
    lastItemId?: string;
  } | null>;
}
