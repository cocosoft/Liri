// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ProviderTopologyWatcher — Provider/模型拓扑观察器（D9 观察者/进程级 HMR）
 *
 * DB（ai_providers / model_registry）是唯一事实来源。任何写入路径（API、
 * 本地同步、迁移、外部工具直写）变更后，本观察器自动把变更同步到运行时：
 *   1. 周期采样两张表的指纹（COUNT + MAX(updated_at)），变更即触发
 *   2. 全量同步 DB Provider → ProviderRegistry（幂等，replace 原子覆盖）
 *   3. 刷新 modelRouter 任务分工缓存（任务配置 HMR）
 *   4. 广播 providers:changed SSE（前端刷新，对齐 dsh adapters-updated）
 *
 * 依赖 setInterval + unref：不阻止进程退出；周期检查失败仅告警，下周期重试。
 */

import { Database } from '@openliri/kernel/external/sqlite3';
import { resolveDbPath, resolveScopedDbPath } from '@openliri/kernel';
// 多租户 P1（2026-10-21）：拓扑指纹按身份分连接（后台轮询 ⇒ 本地共享库）
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('ai:topology-watcher');

/** 默认轮询间隔（毫秒） */
const TOPOLOGY_WATCH_INTERVAL_MS = 5000;

export class ProviderTopologyWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private db: Database | null = null;
  /** 多租户 P1：非本地身份的连接（键 = `<tenantId>:<userId>`；后台定时轮询 ⇒ 恒为本地库） */
  private scopedDbs = new Map<string, Database>();
  private lastFingerprint = '';
  private checking = false;

  constructor(private intervalMs: number = TOPOLOGY_WATCH_INTERVAL_MS) {}

  /** 启动观察器：先建立基线指纹（不触发同步），之后周期检测变更并自动同步 */
  async start(): Promise<void> {
    if (this.timer) return;
    try {
      this.lastFingerprint = await this.readFingerprint();
    } catch (err) {
      // 基线建立失败不致命（表可能尚未创建），置空以触发首轮同步
      void handleError(err, {
        module: 'ai:topology-watcher',
        action: 'startBaseline',
      });
      this.lastFingerprint = '';
    }
    this.timer = setInterval(() => {
      void this.checkAndSync();
    }, this.intervalMs);
    // unref：观察器不阻止进程退出
    (this.timer as unknown as { unref?: () => void })?.unref?.();
    logger.info(
      `Provider 拓扑观察器已启动（间隔 ${this.intervalMs}ms，DB 变更自动同步+HMR）`
    );
  }

  /** 停止观察器 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 关闭**全部**连接（本地 + 各身份分区），幂等。
   *
   * 多租户 P5：删租户前由 `core/identity/scopedResources` 的登记器调用释放分区句柄。
   * 与 `stop()` 分离：只关连接、不停轮询（避免把两件事绑死）。
   */
  close(): void {
    for (const [key, db] of [...this.scopedDbs]) {
      try {
        db.close();
      } catch {
        // 已关闭 / 关闭中：忽略（幂等）
      }
      this.scopedDbs.delete(key);
    }
    try {
      this.db?.close();
    } catch {
      // 已关闭 / 关闭中：忽略（幂等）
    }
    this.db = null;
  }

  /** 采样 ai_providers / model_registry 的变更指纹（count + max updated_at） */
  private async readFingerprint(): Promise<string> {
    const db = await this.getDb();
    const providers = await new Promise<{ c: number; m: number } | undefined>(
      (resolve, reject) => {
        db.get(
          `SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS m FROM ai_providers`,
          (err: Error | null, row: any) => (err ? reject(err) : resolve(row))
        );
      }
    );
    const models = await new Promise<{ c: number; m: number } | undefined>(
      (resolve, reject) => {
        db.get(
          `SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS m FROM model_registry`,
          (err: Error | null, row: any) => (err ? reject(err) : resolve(row))
        );
      }
    );
    return `p:${providers?.c ?? 0}:${providers?.m ?? 0}|m:${models?.c ?? 0}:${models?.m ?? 0}`;
  }

  /**
   * 取连接。
   *
   * 多租户 P1（2026-10-21）：本地身份 / 后台定时轮询 ⇒ 共享库（零变更）；
   * 请求内被调用 ⇒ 该身份自己的库。**按身份分别缓存**，避免"首个调用者决定连接"
   * 导致跨身份串库（单字段换连接在异步交错下不安全）。
   */
  private async getDb(): Promise<Database> {
    const principal = getRequestPrincipal();
    if (!isLocalPrincipal(principal)) {
      const key = principalKeyOf(principal);
      const cached = this.scopedDbs.get(key);
      if (cached) return cached;
      const opened = await this.open(resolveScopedDbPath(principal));
      this.scopedDbs.set(key, opened);
      // 多租户 P5：登记 closer（关该身份连接 + 摘除本实例缓存），删租户时统一释放句柄
      registerScopedResource(key, () => {
        try {
          opened.close();
        } catch {
          // 已关闭：忽略（幂等）
        }
        this.scopedDbs.delete(key);
      });
      return opened;
    }
    if (this.db) return this.db;
    this.db = await this.open(resolveDbPath());
    return this.db;
  }

  private open(path: string): Promise<Database> {
    return new Promise<Database>((resolve, reject) => {
      const db = new Database(path, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  /** 周期检查：指纹变化 → 自动同步运行时 */
  private async checkAndSync(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const fp = await this.readFingerprint();
      if (fp === this.lastFingerprint) return;
      this.lastFingerprint = fp;
      logger.info('检测到 Provider/模型拓扑变更，自动同步运行时（HMR）', {
        fingerprint: fp,
      });
      await this.syncTopology();
    } catch (err) {
      logger.warning('拓扑观察器检查失败（下个周期重试）', {
        error: String(err),
      });
    } finally {
      this.checking = false;
    }
  }

  /** 同步 DB 拓扑到运行时 + 广播前端刷新 */
  private async syncTopology(): Promise<void> {
    const { syncDBProvidersToRegistry } =
      await import('./ProviderSyncService.js');
    await syncDBProvidersToRegistry();

    // 任务分工配置 HMR（模型路由缓存刷新，通知订阅方热切换）
    try {
      const { modelRouter } = await import('../modelRouter.js');
      await modelRouter.refreshTaskCache();
    } catch (err) {
      logger.warning('任务分工缓存刷新失败', { error: String(err) });
    }

    // 前端 HMR：广播 providers:changed（对齐 dsh llm/adapters-updated）
    try {
      const { broadcastEvent } = await import('@modules/infrastructure');
      broadcastEvent('providers:changed', { action: 'sync', providerId: '' });
    } catch {
      // @ignore-catch: SSE 不可用不影响同步
    }
  }
}

/** 全局单例 */
export const providerTopologyWatcher = new ProviderTopologyWatcher();
