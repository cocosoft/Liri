/**
 * VFS 挂载管理类型（前后端冻结契约）
 *
 * 事实源：`.trae/specs/ai-vfs-user-mountable.md` §8.2 冻结的 HTTP 契约。
 * 后端接口由另一路并行实现，本文件仅承载 GET/PUT `/v1/vfs/mounts` 的请求/响应形状。
 */

/** 可挂载的源类型（范围冻结：仅 dev_docs + mcp） */
export type VfsScheme = "dev_docs" | "mcp";

/** 生效挂载点（GET 响应 `mounts` 的元素） */
export interface VfsMountEntry {
  scheme: VfsScheme;
  /** `mcp` 条目的服务器名；`dev_docs` 无此字段 */
  server?: string;
  /** 配置是否启用（用户意图） */
  enabled: boolean;
  /** 是否已在当前进程注册表生效（重启前可能与 enabled 不一致） */
  registered: boolean;
  /** 只读挂载 */
  readOnly: boolean;
}

/** MCP 服务器（供 UI 选择；来源 mcpConnectionManager.getServers()） */
export interface VfsMcpServer {
  name: string;
  connected: boolean;
}

/** GET /v1/vfs/mounts 响应 */
export interface VfsMountsResponse {
  mounts: VfsMountEntry[];
  availableSchemes: string[];
  mcpServers: VfsMcpServer[];
  /** 改配置需重启生效（无热更新；后端固定 true） */
  requiresRestart: boolean;
}

/** PUT /v1/vfs/mounts 请求条目 */
export interface VfsMountInput {
  scheme: VfsScheme;
  server?: string;
  enabled?: boolean;
}

/** PUT /v1/vfs/mounts 成功响应（校验失败为 400 + error.message，不走此形状） */
export interface VfsMountsSaveResponse {
  success: true;
  warnings: string[];
  requiresRestart: boolean;
}
