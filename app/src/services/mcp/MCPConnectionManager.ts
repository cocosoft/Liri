/**
 * MCP连接管理器（适配层）
 *
 * 将 MCPConnectionManager 改为适配层，内部委托 MCPServerManager 执行核心操作。
 * 保留 MCPServerConnection 联合类型（含 SDK Client）以维持消费者兼容性。
 * MCPServerManager 为唯一的管理器实现。
 *
 * @architecture P3 重构要点：
 * - 移除 servers Map → 新增 clientCache（仅缓存 SDK Client 引用）
 * - 移除 serverTools Map → 委托 MCPServerManager 查询工具
 * - 所有查询操作改为委托 getMCPServerManager()
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('services:mcp:connManager');
import {
  getMcpToolsCommandsAndResources,
  reconnectMcpServerImpl,
} from './client';
import {
  MCPServerStatus,
  type ConnectedMCPServer,
  type FailedMCPServer,
  type MCPServerConnection,
  type MCPServerConnectionInfo,
  type MCPToolDefinition,
  type PendingMCPServer,
  type ScopedMcpServerConfig,
  type ServerResource,
  type SerializedTool,
} from './types';
import type { McpCommand } from './commandManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getMCPServerManager } from './MCPServerManager';
// 2026-10-08（MCP 双轨收敛 C-1）：SDK 客户端取用的**单一入口**返回类型
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// 重连常量
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

// 批量更新常量
const MCP_BATCH_FLUSH_MS = 16;

/**
 * C1 连接状态 → `MCPServerStatus`（C-3 投影映射）
 */
function toServerStatus(type: MCPServerConnection['type']): MCPServerStatus {
  switch (type) {
    case 'connected':
      return MCPServerStatus.CONNECTED;
    case 'pending':
      return MCPServerStatus.CONNECTING;
    case 'failed':
    case 'needs-auth':
      return MCPServerStatus.ERROR;
    default:
      return MCPServerStatus.DISCONNECTED;
  }
}

/**
 * `SerializedTool`（C1）→ `MCPToolDefinition`（投影的消费面）
 */
function toToolDefinition(tool: SerializedTool): MCPToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.inputJSONSchema as Record<string, unknown>) ?? {},
  };
}

/**
 * MCP连接管理器（适配层）
 *
 * 管理 MCP 服务器连接状态，内部委托 MCPServerManager 执行连接操作。
 * 保留 MCPServerConnection 联合类型以支持消费者访问 `.client`（SDK Client）。
 */
export class MCPConnectionManager {
  // ==================== 状态字段 ====================
  // ❌ 已移除：servers Map（原存储所有 MCPServerConnection）
  // ❌ 已移除：serverTools Map（原存储序列化工具列表）

  /** SDK Client 引用缓存：仅缓存含有 `.client` 的已连接连接 */
  private clientCache = new Map<string, MCPServerConnection>();

  /** 工具数据缓存：来自初始化流程的 SerializedTool 数据 */
  private toolsCache = new Map<string, SerializedTool[]>();

  /** 重连定时器 */
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  /** 待处理的连接状态更新队列 */
  private pendingUpdates: Array<{
    connection: MCPServerConnection;
    tools?: SerializedTool[];
    commands?: McpCommand[];
    resources?: ServerResource[];
  }> = [];

  /** 批量刷新定时器 */
  private flushTimer: NodeJS.Timeout | null = null;

  // ==================== 初始化 ====================

  /**
   * 初始化 MCP 服务器连接
   * 使用 client.ts 获取 MCPServerConnection 对象（含 SDK Client），同时注册到 MCPServerManager
   */
  async initialize(
    configs: Record<string, ScopedMcpServerConfig>
  ): Promise<void> {
    try {
      const manager = getMCPServerManager();

      const onConnectionAttempt = (result: {
        connection: MCPServerConnection;
        tools: SerializedTool[];
        commands: McpCommand[];
        resources?: ServerResource[];
      }) => {
        this.updateServer(result);
        const { connection, tools } = result;
        if (connection.type === 'connected') {
          manager.addServer(connection.name, connection.config);
        }
      };

      await getMcpToolsCommandsAndResources(onConnectionAttempt, configs);

      // 2026-10-08（MCP 双轨收敛 C-3）：**不再** `manager.connectAll()` —— 消除
      // 「同服务器双连接」。C1（SDK）已完成真实连接；`MCPServerManager` 仅作
      // 注册 + 投影（状态/工具由 `flushPendingUpdates` 推送），**按需**连接
      // （`MCPTool.connect` / CLI `mcp call`）保持不变。
      // 启动健康检查和自动重连
      await manager.initialize();
    } catch (error) {
      await handleError(error, {
        module: 'services:mcp:connection',
        action: 'initialize',
      });
    }
  }

  // ==================== 状态更新机制 ====================

  /**
   * 更新服务器状态
   */
  private updateServer(update: {
    connection: MCPServerConnection;
    tools?: SerializedTool[];
    commands?: McpCommand[];
    resources?: ServerResource[];
  }): void {
    this.pendingUpdates.push(update);

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(
        () => this.flushPendingUpdates(),
        MCP_BATCH_FLUSH_MS
      );
    }
  }

  /**
   * 刷新待更新队列
   * 将待处理更新写入 clientCache 和 toolsCache
   */
  private flushPendingUpdates(): void {
    if (this.pendingUpdates.length === 0) {
      this.flushTimer = null;
      return;
    }

    const updates = this.pendingUpdates;
    this.pendingUpdates = [];
    this.flushTimer = null;

    for (const update of updates) {
      const { connection, tools } = update;

      // 缓存 SDK Client 引用（所有状态都缓存，供消费者查询状态）
      this.clientCache.set(connection.name, connection);

      // 缓存工具数据
      if (tools && tools.length > 0) {
        this.toolsCache.set(connection.name, tools);
      }

      // 已连接的服务注册 onclose 事件
      if (connection.type === 'connected') {
        (connection as unknown as ConnectedMCPServer).client.onclose = () =>
          this.handleDisconnect(connection);
      }

      // C-3 投影：把 C1 状态/工具推给 MCPServerManager（消除双连接后其为唯一数据源）
      this.pushProjection(connection);
    }

    this.emitStateChange();
  }

  /**
   * 推送 C1 连接状态/工具到 `MCPServerManager` 的投影（C-3）
   *
   * 消除双连接后，`MCPServerManager` 不再急切建立自研连接，其对外状态/工具
   * 一律由本投影提供（数据源 = C1），供 marketplace / CLI / `/v1/mcp/tools` 消费。
   */
  private pushProjection(connection: MCPServerConnection): void {
    const tools = this.toolsCache.get(connection.name) ?? [];
    getMCPServerManager().setProjection(connection.name, {
      status: toServerStatus(connection.type),
      tools: tools.map(toToolDefinition),
      error: connection.type === 'failed' ? connection.error : undefined,
    });
  }

  // ==================== 断开与重连 ====================

  /**
   * 处理服务器断开连接
   */
  private handleDisconnect(client: MCPServerConnection): void {
    const configType = client.config.type ?? 'stdio';

    if (configType === 'stdio' || configType === 'sdk') {
      this.updateServer({
        connection: { ...client, type: 'failed' } as MCPServerConnection,
      });
      return;
    }

    const existingTimer = this.reconnectTimers.get(client.name);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(client.name);
    }

    this.reconnectWithBackoff(client);
  }

  /**
   * 指数退避重连
   */
  private async reconnectWithBackoff(
    client: MCPServerConnection
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      this.updateServer({
        connection: {
          ...client,
          type: 'pending',
          reconnectAttempt: attempt,
          maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
        } as MCPServerConnection,
      });

      try {
        const result = await reconnectMcpServerImpl(client.name, client.config);

        if (result.connection.type === 'connected') {
          logger.info(
            `Reconnection successful for server ${client.name} (attempt ${attempt})`
          );
          this.reconnectTimers.delete(client.name);
          this.updateServer(result);
          return;
        }

        if (attempt === MAX_RECONNECT_ATTEMPTS) {
          logger.warn(
            `Max reconnection attempts reached for server ${client.name}`
          );
          this.reconnectTimers.delete(client.name);
          this.updateServer(result);
          return;
        }
      } catch (error) {
        await handleError(error, {
          module: 'services:mcp:connection',
          action: 'reconnect_attempt',
          context: { serverName: client.name, attempt },
        });

        if (attempt === MAX_RECONNECT_ATTEMPTS) {
          logger.warn(
            `Max reconnection attempts reached for server ${client.name}`
          );
          this.reconnectTimers.delete(client.name);
          this.updateServer({
            connection: {
              ...client,
              type: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
            } as MCPServerConnection,
          });
          return;
        }
      }

      const backoffMs = Math.min(
        INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
        MAX_BACKOFF_MS
      );

      logger.info(
        `Scheduling reconnection attempt ${attempt + 1} for server ${client.name} in ${backoffMs}ms`
      );

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, backoffMs);
        this.reconnectTimers.set(client.name, timer);
      });
    }
  }

  // ==================== 对外查询接口 ====================

  /**
   * 重连指定服务器
   * 委托 MCPServerManager 执行，同步状态到 clientCache
   */
  async reconnectServer(serverName: string): Promise<MCPServerConnection> {
    const cached = this.clientCache.get(serverName);
    if (!cached) {
      throw new AppError(
        `Server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const existingTimer = this.reconnectTimers.get(serverName);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(serverName);
    }

    try {
      const manager = getMCPServerManager();
      await manager.reconnectServer(serverName);
      this.clientCache.set(serverName, {
        ...cached,
        type: 'connected',
      } as MCPServerConnection);
    } catch (error) {
      this.clientCache.set(serverName, {
        ...cached,
        type: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as MCPServerConnection);
    }

    // C-3：同步投影（状态变更必须反映到 MCPServerManager）
    this.pushProjection(this.clientCache.get(serverName)!);
    return this.clientCache.get(serverName)!;
  }

  /**
   * 切换服务器启用状态
   * 委托 MCPServerManager 执行，同步状态到 clientCache
   */
  async toggleServer(serverName: string): Promise<void> {
    const manager = getMCPServerManager();
    try {
      await manager.toggleServer(serverName);

      const existing = this.clientCache.get(serverName);
      if (existing) {
        // 根据 MCPServerManager 的状态更新 clientCache
        this.clientCache.set(serverName, {
          ...existing,
          type: existing.type === 'connected' ? 'failed' : 'connected',
        } as MCPServerConnection);
        // C-3：同步投影（状态变更必须反映到 MCPServerManager）
        this.pushProjection(this.clientCache.get(serverName)!);
      }
    } catch (error) {
      await handleError(error, {
        module: 'services:mcp:connection',
        action: 'toggle_server',
        context: { serverName },
      });
    }
  }

  // ==================== 查询方法 ====================

  /**
   * 获取所有服务器
   * 委托 MCPServerManager.listServers() + clientCache 补充
   */
  getServers(): MCPServerConnection[] {
    const manager = getMCPServerManager();
    const allNames = manager.listServers();
    const seenNames = new Set<string>();

    // 1. 从 clientCache 返回已缓存的连接（含 .client）
    const result: MCPServerConnection[] = [];
    for (const name of allNames) {
      const cached = this.clientCache.get(name);
      if (cached) {
        result.push(cached);
        seenNames.add(name);
      }
    }

    // 2. clientCache 有、但 MCPServerManager 未列出的条目：**直接回放真实缓存记录**。
    // 2026-10-08（**真实 MCP e2e 抓出的诊断性缺陷**修复）：此前这里**丢弃真实连接对象**，
    // 合成一条 `type:'failed'` 并**编造**文案 `'Server removed from registry'` ⇒ 既**掩盖
    // 真实状态**（该条目可能是 `connected` 且持有活 SDK Client），又属**编造数据**。
    for (const [name, cached] of this.clientCache) {
      if (!seenNames.has(name)) {
        result.push(cached);
      }
    }

    // 3. MCPServerManager 有、clientCache 未覆盖：按 manager 的**真实 `status`** 如实映射
    //（不再一律 `failed`、不再编造 `'No active connection'`）
    const infos = manager.getServerInfos();
    for (const name of allNames) {
      if (seenNames.has(name)) continue;
      const info = infos.find((i) => i.name === name);
      if (info) {
        result.push(this.fromManagerInfo(info));
      }
    }

    return result;
  }

  /**
   * 取该服务器**已连接的 SDK `Client`**（2026-10-08，MCP 双轨收敛 C-1）。
   *
   * 为什么要这个入口：此前"取 SDK 客户端"的逻辑在 3 处各写一遍
   * （`MCPToolBridge` 的 wrapper getter、工具实现…），且都写成 `(server as any).client`
   * —— **裸 cast 掩盖了"该条目不一定是 SDK 连接"这一事实**（`getServer()` 的
   * `MCPServerManager` 后备项**不含 `.client`**，见本方法上方的注释）。
   * 本方法把判据收敛为**一处**：只有 `clientCache` 里 `type === 'connected'` 的条目才有 SDK Client
   * —— 其余（failed / pending / needs-auth / 后备桩）一律返回 `undefined`，由调用方**显式处理**。
   */
  getSdkClient(serverName: string): Client | undefined {
    const cached = this.clientCache.get(serverName);
    if (!cached || cached.type !== 'connected') return undefined;
    return (cached as ConnectedMCPServer).client as unknown as Client;
  }

  /**
   * 获取单个服务器
   * clientCache 优先，MCPServerManager 后备
   */
  getServer(name: string): MCPServerConnection | undefined {
    // 1. clientCache 优先
    const cached = this.clientCache.get(name);
    if (cached) {
      return cached;
    }

    // 2. MCPServerManager 后备（不含 .client）—— 按**真实 `status`** 如实映射（见 `fromManagerInfo`）
    const manager = getMCPServerManager();
    const infos = manager.getServerInfos();
    const info = infos.find((i) => i.name === name);
    if (info) {
      return this.fromManagerInfo(info);
    }

    return undefined;
  }

  /**
   * 由 `MCPServerManager` 的**注册信息**合成一条连接记录（`clientCache` 尚未覆盖时使用）。
   *
   * 2026-10-08（**真实 MCP server e2e 抓出的诊断性缺陷**修复）：
   * - 此前**一律**合成 `type:'failed'` 并兜底 `error: info.error || 'No active connection'`
   *   ⇒ ① 把**健康的在途**服务器误报为失败（`manager.addServer` **立即**执行，而
   *   `clientCache` 是 **16ms 批量刷新**，二者之间存在竞态窗口 —— 实测在
   *   `Added MCP server` 日志后 **7ms** 就有调用方拿到 `failed`）；② 用兜底文案
   *   **覆盖/编造**错误，**丢掉真实原因**（本次首轮误判即由此而来，排查成本极高）。
   * - 现按 `status` 如实映射：`ERROR` ⇒ `failed`（**透传** `info.error`，**不编造**文案）；
   *   其余（`CONNECTING` / `CONNECTED` 尚未落入缓存 / `DISCONNECTED`）⇒ `pending`
   *   （"未连接 / 在途"，**非失败**）。
   */
  private fromManagerInfo(
    info: MCPServerConnectionInfo
  ): PendingMCPServer | FailedMCPServer {
    const base = {
      name: info.name,
      config: info.config as ScopedMcpServerConfig,
    };
    if (info.status === MCPServerStatus.ERROR) {
      return { ...base, type: 'failed', error: info.error };
    }
    return { ...base, type: 'pending' };
  }

  /**
   * 获取指定服务器的序列化工具列表
   * 委托 toolsCache 查询
   */
  getServerTools(serverName: string): SerializedTool[] {
    return this.toolsCache.get(serverName) || [];
  }

  /**
   * 外部注入服务器工具到 toolsCache
   * 用于 MCPToolBridge 通过 refreshAllTools 重新同步时能发现这些工具。
   * DocModule 等模块通过 MCPServerManager 连接服务器后，可调用此方法注入工具。
   */
  addServerTools(serverName: string, tools: SerializedTool[]): void {
    this.toolsCache.set(serverName, tools);
  }

  /**
   * 获取所有服务器的序列化工具列表（扁平化）
   * 委托 toolsCache 构建
   */
  getAllTools(): Map<string, { serverName: string; tools: SerializedTool[] }> {
    const result = new Map<
      string,
      { serverName: string; tools: SerializedTool[] }
    >();
    for (const [name, tools] of this.toolsCache.entries()) {
      result.set(name, { serverName: name, tools });
    }
    return result;
  }

  // ==================== 清理 ====================

  /**
   * 关闭所有连接
   * 委托 MCPServerManager 执行，清理本地缓存
   */
  async closeAll(): Promise<void> {
    // 2026-10-08（**真实 MCP server e2e 抓出的进程泄漏**修复）：**先**逐个关闭
    // `clientCache` 中 connected 条目的 SDK `Client`（其 `cleanup()` 即 `client.close()`，
    // 见 `client.ts` 的 `connectedClient.cleanup`）。此前只调 `manager.closeAll()`
    // —— 那**仅断开自研 `MCPConnection`** —— 再清空缓存 ⇒ SDK 的 stdio 子进程
    // （如 `npx` 拉起的 MCP server）**无人关闭** ⇒ 僵尸进程泄漏
    // （真实 e2e 里必须手动 `client.close()` 才能让进程干净退出，即为该缺陷的直接证据）。
    const cachedConnections = Array.from(this.clientCache.values());
    for (const conn of cachedConnections) {
      if (conn.type !== 'connected') continue;
      try {
        await conn.cleanup();
      } catch (error) {
        await handleError(error, {
          module: 'services:mcp:connection',
          action: 'close_sdk_client',
          context: { serverName: conn.name },
        });
      }
    }

    const manager = getMCPServerManager();
    await manager.closeAll();

    // 清理重连定时器
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // 清理批量刷新定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 清理本地缓存
    this.clientCache.clear();
    this.toolsCache.clear();
    this.pendingUpdates = [];
  }

  // ==================== 内部方法 ====================

  /**
   * 触发状态更新事件
   */
  private emitStateChange(): void {
    logger.debug('MCP state changed');
  }
}

// 导出单例
export const mcpConnectionManager = new MCPConnectionManager();
