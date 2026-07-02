/**
 * PlatformRouter — 多平台路由管理器
 *
 * 管理多个 PlatformAdapter 实例，提供统一路由：
 * - 会话到平台的映射
 * - 消息广播到所有平台
 * - 平台健康状态监控
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type {
  PlatformAdapter,
  PlatformConfig,
  PlatformMessage,
  PlatformSendResult,
  PlatformType,
} from './PlatformAdapter';
import type { UnifiedMessage } from '../types/Message';

const logger = new Logger({
  module: 'session:platformRouter',
  level: LogLevel.INFO,
});

export interface PlatformRouteEntry {
  adapter: PlatformAdapter;
  config: PlatformConfig;
  sessionFilter?: (sessionId: string) => boolean;
  priority: number;
}

export class PlatformRouter {
  private adapters: Map<string, PlatformRouteEntry> = new Map();
  private sessionRoutes: Map<string, string[]> = new Map();

  registerAdapter(
    name: string,
    adapter: PlatformAdapter,
    config: PlatformConfig,
    options?: {
      sessionFilter?: (sessionId: string) => boolean;
      priority?: number;
    }
  ): void {
    this.adapters.set(name, {
      adapter,
      config,
      sessionFilter: options?.sessionFilter,
      priority: options?.priority ?? 0,
    });

    logger.info('平台适配器已注册', { name, platform: config.platform });
  }

  unregisterAdapter(name: string): boolean {
    const removed = this.adapters.delete(name);
    if (removed) {
      for (const [sessionId, routes] of this.sessionRoutes) {
        this.sessionRoutes.set(
          sessionId,
          routes.filter((r) => r !== name)
        );
      }
    }
    return removed;
  }

  getAdapter(name: string): PlatformAdapter | undefined {
    return this.adapters.get(name)?.adapter;
  }

  getAdapterNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  bindSession(sessionId: string, adapterName: string): boolean {
    if (!this.adapters.has(adapterName)) return false;

    const existing = this.sessionRoutes.get(sessionId) ?? [];
    if (!existing.includes(adapterName)) {
      existing.push(adapterName);
    }
    this.sessionRoutes.set(sessionId, existing);
    return true;
  }

  unbindSession(sessionId: string, adapterName?: string): void {
    if (adapterName) {
      const routes = this.sessionRoutes.get(sessionId);
      if (routes) {
        this.sessionRoutes.set(
          sessionId,
          routes.filter((r) => r !== adapterName)
        );
      }
    } else {
      this.sessionRoutes.delete(sessionId);
    }
  }

  getSessionRoutes(sessionId: string): string[] {
    return this.sessionRoutes.get(sessionId) ?? [];
  }

  async connectAll(): Promise<void> {
    const entries = Array.from(this.adapters.entries());
    await Promise.all(
      entries.map(async ([name, entry]) => {
        try {
          await entry.adapter.connect(entry.config);
        } catch (err) {
          logger.error('平台适配器连接失败', {
            name,
            error: String(err),
          });
        }
      })
    );
  }

  async disconnectAll(): Promise<void> {
    const entries = Array.from(this.adapters.entries());
    await Promise.all(
      entries.map(async ([name, entry]) => {
        try {
          await entry.adapter.disconnect();
        } catch (err) {
          logger.warning('平台适配器断开失败', {
            name,
            error: String(err),
          });
        }
      })
    );
  }

  async sendToSession(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<PlatformSendResult[]> {
    const adapterNames = this.getSessionRoutes(sessionId);
    const results: PlatformSendResult[] = [];

    if (adapterNames.length === 0) {
      const allEntries = this.getSortedEntries();
      for (const entry of allEntries) {
        if (entry.sessionFilter && !entry.sessionFilter(sessionId)) continue;
        const result = await entry.adapter.sendMessage(sessionId, message);
        results.push(result);
      }
    } else {
      for (const name of adapterNames) {
        const entry = this.adapters.get(name);
        if (!entry) continue;
        const result = await entry.adapter.sendMessage(sessionId, message);
        results.push(result);
      }
    }

    return results;
  }

  async broadcast(message: UnifiedMessage): Promise<PlatformSendResult[][]> {
    const results: PlatformSendResult[][] = [];

    for (const entry of this.getSortedEntries()) {
      const result = await entry.adapter.sendMessage('broadcast', message);
      results.push([result]);
    }

    return results;
  }

  getHealthStatus(): Array<{
    name: string;
    platform: PlatformType;
    connected: boolean;
    status: PlatformAdapter['getConnectionStatus'];
  }> {
    return Array.from(this.adapters.entries()).map(([name, entry]) => ({
      name,
      platform: entry.config.platform,
      connected: entry.adapter.isConnected(),
      status: entry.adapter.getConnectionStatus,
    }));
  }

  getRouteCount(): number {
    return this.adapters.size;
  }

  getSessionBindingCount(): number {
    return this.sessionRoutes.size;
  }

  private getSortedEntries(): PlatformRouteEntry[] {
    return Array.from(this.adapters.values()).sort(
      (a, b) => b.priority - a.priority
    );
  }
}
