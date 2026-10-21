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

export class ScopedStorageRegistry {
  private readonly scoped = new Map<string, UnifiedSessionStorage>();

  /** @param shared 构造时的共享存储实例（本地身份与"无作用域"路径） */
  constructor(private readonly shared: UnifiedSessionStorage) {}

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
