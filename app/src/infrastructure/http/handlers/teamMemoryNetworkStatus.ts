/**
 * 网络版团队记忆同步状态（2N-4 设置页状态，2026-11-25）
 *
 * 从 `defaultTeamMemorySyncService` 投影出前端可展示的只读 DTO。
 * 放在独立小模块：handler 只做取数 + 序列化，DTO 形状可单测（不拉起 MemoryManager/CoreAPI）。
 * **不含令牌**（`TeamMemorySyncConfig` 本身不带令牌字段）。
 */

export interface TeamMemoryNetworkStatusDto {
  /** `serverUrl` 已配置（网络版启用条件；与共享目录版开关相互独立） */
  configured: boolean;
  teamId: string;
  /** 后端 `SyncStatus`：idle / syncing / success / conflict / error / not_configured */
  status: string;
  /** 最近一次同步完成时间（毫秒）；从未同步 ⇒ null（不展示 1970） */
  lastSyncAt: number | null;
  /** 最近一次失败原因（成功后清空） */
  lastError: string | null;
}

/** 投影所需的同步器最小面（便于单测注入替身） */
export interface TeamMemoryNetworkStatusSource {
  getConfig(): { serverUrl: string; teamId: string };
  getStatus(): string;
  getLastSyncTime(): number;
  getLastError(): string | null;
}

export function buildTeamMemoryNetworkStatus(
  service: TeamMemoryNetworkStatusSource
): TeamMemoryNetworkStatusDto {
  const config = service.getConfig();
  const lastSyncAt = service.getLastSyncTime();
  return {
    configured: Boolean(config.serverUrl),
    teamId: config.teamId,
    status: service.getStatus(),
    lastSyncAt: lastSyncAt > 0 ? lastSyncAt : null,
    lastError: service.getLastError(),
  };
}

/**
 * 团队同步"已配置"判定（Phase 2N-11，2026-11-25）。
 *
 * 原实现 = `enabled && sharedDir` ⇒ **只配了网络（serverUrl）时被整体判为未配置**，
 * 设置页随即渲染"未启用共享目录同步"并把网络状态/审计/候选/「立即同步」全部隐藏。
 * 现语义：共享目录**或**网络任一可用即为已配置（二者开关相互独立）。
 */
export function computeTeamMemoryConfigured(input: {
  enabled: boolean;
  sharedDir: string;
  networkConfigured: boolean;
}): boolean {
  if (!input.enabled) return false;
  return input.sharedDir.trim().length > 0 || input.networkConfigured;
}
