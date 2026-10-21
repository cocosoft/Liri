/**
 * ScopedStorageRegistry — 会话存储的**身份分区注册表**（多租户 P1）
 *
 * 从 `SessionGateway` 抽出（该文件触达 2000 行上限）：
 *   - 本地身份（桌面 / CLI / 后台 / 无请求作用域）⇒ 永远返回构造时注入的共享实例（零变更）；
 *   - 已认证身份 ⇒ `<data>/tenants/<tenantId>/users/<userId>/sessions/<worktreeHash>` 上的
 *     独立实例（独立内存索引 + `discoverLegacyRoots: false` ⇒ 绝不探测本机共享分区）。
 *
 * 为什么按身份建**独立实例**而不是"共享实例换根"：`FileSystemUnifiedStorage` 自带会话/消息
 * 内存索引与写队列，换根会让两个身份的索引互相污染；独立实例是最小且可证的隔离边界。
 */
import type { UnifiedSessionStorage } from '../storage/UnifiedStorage.js';
import { StorageType } from '../storage/UnifiedStorage.js';
import { StorageFactory } from '../storage/StorageFactory.js';
import { resolveScopedSessionsDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '../../core/identity/requestScope.js';

const logger = getLogger('session:gateway');

/**
 * 进程内已创建的注册表（删除租户时需要遍历**全部**实例丢缓存）。
 *
 * 与 `InboxManager` 的 `liveInstances` 同型：注册表本身被 `SessionGateway` 持有，
 * 但清理入口是模块级函数（purge 无需拿到 gateway）。
 */
const liveRegistries = new Set<ScopedStorageRegistry>();

/**
 * 删除租户后丢弃其会话存储实例（并 `close()` 释放内部索引/写队列）。
 *
 * 为什么要丢：实例缓存着**已删目录**的基路径与内存索引；不丢则后续写入会把目录重建回来。
 *
 * @returns 丢弃的实例数
 */
export async function forgetScopedStoragesForTenant(
  tenantId: string
): Promise<number> {
  const prefix = `${tenantId}:`;
  let dropped = 0;
  for (const registry of liveRegistries) {
    dropped += await registry.forgetScopedForTenant(prefix);
  }
  return dropped;
}

export class ScopedStorageRegistry {
  private readonly scoped = new Map<string, UnifiedSessionStorage>();

  /** @param shared 构造时的共享存储实例（本地身份与"无作用域"路径） */
  constructor(private readonly shared: UnifiedSessionStorage) {
    liveRegistries.add(this);
  }

  /**
   * 丢弃归属键以 `ownerPrefix` 开头的存储实例（关连接 + 摘除缓存）
   *
   * 公开仅为供模块级 `forgetScopedStoragesForTenant` 遍历本进程内的注册表；
   * 业务代码不要直接调用（清理入口只有那一个）。
   */
  async forgetScopedForTenant(ownerPrefix: string): Promise<number> {
    let dropped = 0;
    for (const [key, store] of [...this.scoped]) {
      if (!key.startsWith(ownerPrefix)) continue;
      try {
        await store.close();
      } catch (err) {
        // 关闭失败不阻断清理：缓存照样摘除（下次访问会重建实例）
        logger.warn('会话存储实例关闭失败（继续摘除缓存）', {
          principalKey: key,
          error: String(err),
        });
      }
      this.scoped.delete(key);
      dropped += 1;
    }
    return dropped;
  }

  /** 当前请求身份的存储实例（本地 ⇒ 共享实例） */
  async forCurrentPrincipal(): Promise<UnifiedSessionStorage> {
    const principal = getRequestPrincipal();
    if (isLocalPrincipal(principal)) return this.shared;

    const key = principalKeyOf(principal);
    const cached = this.scoped.get(key);
    if (cached) return cached;

    const store = StorageFactory.createStorage({
      type: StorageType.FILESYSTEM,
      basePath: resolveScopedSessionsDir(principal),
      discoverLegacyRoots: false,
    });
    await store.initialize();
    this.scoped.set(key, store);
    logger.info('SessionGateway:已建立租户分区存储实例', {
      principalKey: key,
      basePath: resolveScopedSessionsDir(principal),
    });
    return store;
  }
}
