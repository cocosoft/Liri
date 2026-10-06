import { AsyncLocalStorage } from 'async_hooks';
// 2026-10-01 B14 B′ 步：本文件由 `context/AsyncContextStorage.ts` 迁入 `utils/`(infra)。
// 类型依赖随之改为类型中心（core）—— A′ 步已把 Context 家族下沉 `src/types/context.ts`
// ⇒ 此处为 `infra -> core`（合法），不再构成 `infra -> context`(app) 倒挂。
import type { Context, SessionContext } from '../types/context';

export class AsyncContextStorage {
  private storage = new AsyncLocalStorage<Record<string, Context>>();

  run<T>(context: Record<string, Context>, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  getStore(): Record<string, Context> | undefined {
    return this.storage.getStore();
  }

  hasStore(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /**
   * 内部实现细节：Node.js < 20 时 `resetStore()` 的降级路径（`enterWith` 不可用）。
   * ⚠️ B 类复核订正（2026-10-07）：原标注「使用 resetStore() 替代」表述**失实** ——
   * `resetStore()` 自身即调用本方法（二者非替代关系）。全仓 grep **零外部调用**
   * ⇒ 收紧为 `private`，不再是公开 API。
   */
  private clearStore(): void {
    this.storage.run({}, () => {});
  }

  /**
   * 重置当前 store 为空。使用 enterWith({}) 确保同一 async 链中后续 getStore() 返回空。
   * Node.js 20+；< 20 自动降级为 run({}, fn)。
   */
  resetStore(): void {
    // BUG-ε fix: Node.js < 20 fallback
    if (typeof this.storage.enterWith === 'function') {
      this.storage.enterWith({});
    } else {
      this.clearStore();
    }
  }

  /**
   * 恢复当前 store 到指定的上下文快照。
   * Node.js 20+；< 20 自动降级为 run(snapshot, fn)。
   */
  restoreStore(snapshot: Record<string, Context>): void {
    // BUG-ε fix: Node.js < 20 fallback
    if (typeof this.storage.enterWith === 'function') {
      this.storage.enterWith(snapshot);
    } else {
      this.storage.run(snapshot, () => {});
    }
  }
}

export const asyncContextStorage = new AsyncContextStorage();

/**
 * 获取当前异步上下文中的会话上下文
 * 在 SessionGateway 入口注入后，深层调用链可通过此函数获取会话信息
 */
export function getCurrentSessionContext(): SessionContext | undefined {
  const store = asyncContextStorage.getStore();
  return store?.session as SessionContext | undefined;
}
