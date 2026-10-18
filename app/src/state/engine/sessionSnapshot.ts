/**
 * sessionSnapshot — 会话级快照**提供者注册表**（U-14 阶段 1.3，2026-10-18）。
 *
 * ## 为什么需要
 * `CouncilEngine` / `TaskOrchestrator` 已实现可选 `ISnapshotCapable`（阶段 1.2），但生产代码
 * **没有任何调用方** ⇒ 「可被探测」不等于「被挂起中心使用」。本模块是二者之间的**唯一接线点**：
 * 挂起协调器按 `sessionId` 冻结/恢复，引擎按同一 `sessionId` 过滤自己的内存态。
 *
 * ## 边界
 * - **不 import 任何具体引擎**：提供者由装配点（`query/orchestrationSnapshotProviders.ts`）
 *   显式注册 ⇒ `state` 不反向依赖 `workspace` / `tasks`。
 * - **句柄不透明**：本模块只按 `kind` 存取 `unknown`，不解释、不改写（中心层只做搬运）。
 * - **失败只留痕**：单个提供者冻结/恢复失败**不得**中断挂起/续跑（CS03），逐条 `logger.warn`。
 * - **按会话过滤是契约**：提供者收到 `sessionId` 时必须只处理该会话；全量快照会覆盖
 *   其它仍在运行的会话（这正是本模块存在的理由）。
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('state:sessionSnapshot');

/** 会话级快照提供者（由编排引擎在装配点注册） */
export interface ScopedSnapshotProvider {
  /** 提供者标识（日志/句柄键用，不参与业务判定） */
  readonly kind: string;
  /** 冻结**该会话**的内存态；返回不透明句柄（中心层不落盘、不解释） */
  freezeSession(sessionId: string): unknown;
  /** 以句柄恢复**该会话**的内存态（不得影响其它会话） */
  restoreSession(sessionId: string, snapshot: unknown): void;
}

/** 会话级快照（中心层只做不透明搬运） */
export interface SessionSnapshot {
  /** 快照所属会话（恢复时原样传回提供者） */
  readonly sessionId: string;
  /** `provider.kind → 提供者句柄` */
  readonly handles: Record<string, unknown>;
}

const providers = new Map<string, ScopedSnapshotProvider>();

/** 注册提供者，返回注销函数（幂等）。 */
export function registerScopedSnapshotProvider(
  provider: ScopedSnapshotProvider
): () => void {
  providers.set(provider.kind, provider);
  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    if (providers.get(provider.kind) === provider) {
      providers.delete(provider.kind);
    }
  };
}

/** 当前提供者数（健康检查 / 测试断言用） */
export function getScopedSnapshotProviderCount(): number {
  return providers.size;
}

/**
 * 冻结某会话的快照。
 *
 * @returns 快照；无提供者或全部失败 ⇒ `null`（调用方据此跳过登记，不造空句柄）
 */
export function freezeSessionSnapshot(
  sessionId: string
): SessionSnapshot | null {
  if (providers.size === 0) return null;
  const handles: Record<string, unknown> = {};
  let captured = 0;
  for (const provider of providers.values()) {
    try {
      handles[provider.kind] = provider.freezeSession(sessionId);
      captured += 1;
    } catch (err) {
      // 冻结失败不得阻断挂起（CS03）：该提供者本轮缺席，其余照常
      logger.warn('sessionSnapshot:freeze_failed（仅留痕）', {
        kind: provider.kind,
        sessionId,
        error: String(err),
      });
    }
  }
  return captured > 0 ? { sessionId, handles } : null;
}

/**
 * 按快照恢复各提供者。未知 `kind`（提供者已注销）静默跳过 —— 句柄可能来自旧装配。
 */
export function restoreSessionSnapshot(snapshot: SessionSnapshot): void {
  for (const [kind, handle] of Object.entries(snapshot.handles)) {
    const provider = providers.get(kind);
    if (!provider) continue;
    try {
      provider.restoreSession(snapshot.sessionId, handle);
    } catch (err) {
      logger.warn('sessionSnapshot:restore_failed（仅留痕）', {
        kind,
        sessionId: snapshot.sessionId,
        error: String(err),
      });
    }
  }
}

/** 测试隔离：清空全部提供者。生产代码不调用（正常路径走注销函数）。 */
export function resetScopedSnapshotProvidersForTest(): void {
  providers.clear();
}
