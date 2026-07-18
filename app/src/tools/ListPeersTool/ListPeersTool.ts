/**
 * 列出Peers工具
 * 用于发现本地peer（UDS）或远程会话（bridge）
 * 参考CC源码 cc_code/backend/tools/ListPeersTool/ListPeersTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';
import { readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { resolveDataSubDir } from '@modules/core';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:ListPeersTool:ListPeersTool', level: LogLevel.INFO });

/**
 * Peer信息
 */
export interface PeerInfo {
  id: string;
  type: 'uds' | 'bridge' | 'local';
  address: string;
  status: 'active' | 'inactive';
  lastSeen?: string;
}

/**
 * 列出Peers输入
 */
export interface ListPeersInput {
  /**
   * 过滤类型（uds、bridge、local）
   */
  type?: string;
}

/**
 * 列出Peers输出
 */
export interface ListPeersOutput {
  peers: PeerInfo[];
  total: number;
  active: number;
}

/**
 * 列出Peers工具
 */
export class ListPeersTool extends BaseTool<ListPeersInput, ListPeersOutput> {
  /**
   * 工具名称
   */
  name = 'ListPeers';

  /**
   * 工具描述
   */
  description =
    '发现本地peer（UDS socket）或远程会话（bridge）。用于查找可连接的Agent进程。';

  /**
   * 工具参数
   */
  params = [
    {
      name: 'type',
      type: 'string',
      description: '过滤类型（uds、bridge、local）',
      required: false,
    },
  ];

  override searchHint = 'discover local peers and remote sessions';

  override maxResultSizeChars = 100_000;

  override shouldDefer = true;

  private socketDir: string;

  constructor() {
    super();
    this.socketDir = resolveDataSubDir('sockets');
  }

  override isEnabled(): boolean {
    return true;
  }

  override isReadOnly(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 扫描本地socket目录
   */
  private scanLocalSockets(): PeerInfo[] {
    const peers: PeerInfo[] = [];

    if (!existsSync(this.socketDir)) {
      return peers;
    }

    try {
      const entries = readdirSync(this.socketDir);

      for (const entry of entries) {
        const socketPath = join(this.socketDir, entry);

        try {
          const stats = statSync(socketPath);

          if (stats.isSocket() || stats.isFIFO()) {
            peers.push({
              id: entry,
              type: 'uds',
              address: `uds:${socketPath}`,
              status: 'active',
              lastSeen: new Date(stats.mtime).toISOString(),
            });
          }
        } catch (err) {

          // 忽略无法访问的socket

          logger.debug("Operation skipped", { context: "忽略无法访问的socket", error: err instanceof Error ? err.message : String(err) });

        }
      }
    } catch (err) {

      // 目录不存在或无法访问

      logger.debug("Operation skipped", { context: "目录不存在或无法访问", error: err instanceof Error ? err.message : String(err) });

    }

    return peers;
  }

  /**
   * 扫描bridge会话
   */
  private scanBridgeSessions(): PeerInfo[] {
    const peers: PeerInfo[] = [];

    // 检查bridge状态文件
    const bridgeDir = resolveDataSubDir('bridge');
    if (!existsSync(bridgeDir)) {
      return peers;
    }

    try {
      const entries = readdirSync(bridgeDir);

      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const sessionId = entry.replace('.json', '');
          peers.push({
            id: sessionId,
            type: 'bridge',
            address: `bridge:${sessionId}`,
            status: 'active',
          });
        }
      }
    } catch (err) {

      // 目录不存在或无法访问

      logger.debug("Operation skipped", { context: "目录不存在或无法访问", error: err instanceof Error ? err.message : String(err) });

    }

    return peers;
  }

  /**
   * 扫描本地进程
   */
  private scanLocalProcesses(): PeerInfo[] {
    const peers: PeerInfo[] = [];

    // 检查 teammates
    try {
      const { getTeammateManager } = require('../../subagent/TeammateManager');
      const manager = getTeammateManager();
      const teammates = manager.getActiveTeammates();

      for (const teammate of teammates) {
        peers.push({
          id: teammate.id,
          type: 'local',
          address: `local:${teammate.name}`,
          status: teammate.status === 'running' ? 'active' : 'inactive',
        });
      }
    } catch (err) {

      // TeammateManager不可用

      logger.debug("Operation skipped", { context: "TeammateManager不可用", error: err instanceof Error ? err.message : String(err) });

    }

    return peers;
  }

  /**
   * 执行列出Peers
   */
  async execute(
    input: ListPeersInput,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<ListPeersOutput>> {
    const { type } = input;

    const peers: PeerInfo[] = [];

    // 根据类型过滤扫描
    if (!type || type === 'uds') {
      peers.push(...this.scanLocalSockets());
    }

    if (!type || type === 'bridge') {
      peers.push(...this.scanBridgeSessions());
    }

    if (!type || type === 'local') {
      peers.push(...this.scanLocalProcesses());
    }

    const activePeers = peers.filter((p) => p.status === 'active');

    return createToolResult(
      {
        peers,
        total: peers.length,
        active: activePeers.length,
      },
      {
        newMessages: [
          {
            role: 'system',
            content: `发现 ${peers.length} 个peer(s)，其中 ${activePeers.length} 个活跃`,
          },
        ],
      }
    );
  }

  override userFacingName(): string {
    return '列出Peers';
  }

  override getActivityDescription(): string | null {
    return '扫描peers';
  }
}

/**
 * 创建列出Peers工具实例
 */
export function createListPeersTool(): ListPeersTool {
  return new ListPeersTool();
}
