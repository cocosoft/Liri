/**
 * SessionManagerAdapter
 * 将 SessionGateway 包装为 SessionManager 兼容接口，
 * 使存量代码无需修改即可使用新后端。
 *
 * 迁移路径：
 *   const gateway = new SessionGateway();
 *   const adapter = new SessionManagerAdapter(gateway);
 *   const store = createSupervisorStore(adapter.store);
 */

import { SessionGateway } from './SessionGateway';
import { UnifiedStorageAdapter } from './storage/UnifiedStorageAdapter';
import { SessionStore } from './SessionStore';

export class SessionManagerAdapter {
  readonly store: SessionStore;

  constructor(gateway: SessionGateway) {
    const unifiedStorage = gateway.getStorage();
    const storageAdapter = new UnifiedStorageAdapter(unifiedStorage);
    this.store = new SessionStore({ storage: storageAdapter });
  }
}
