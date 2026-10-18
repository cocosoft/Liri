/**
 * orchestrationSnapshotProviders — 编排引擎的会话级快照**装配点**（U-14 阶段 1.3）。
 *
 * `CouncilEngine` 与 `TaskOrchestrator` 已实现可选 `ISnapshotCapable`（阶段 1.2），但能力
 * 只有被中心层调用才有意义。本模块把两个单例注册进 `state/engine/sessionSnapshot` 注册表：
 *
 * - **按会话过滤**：`freezeSession(sessionId)` 只冻结该会话的 Council 会话 / Plan —— 挂起
 *   协调器按 `sessionId` 挂起，全量快照会在恢复时覆盖其它仍在运行的会话。
 * - **只做搬运**：不解释句柄内容，不落盘（引擎侧同为内存态；挂起事实源仍在各链检查点）。
 * - **显式装配**：不在模块导入期产生副作用，由 `ChatBootstrap` 启动序列调用一次。
 */

import { registerScopedSnapshotProvider } from '../state/engine/sessionSnapshot.js';
import { getCouncilEngine } from '../workspace/CouncilEngine.js';
import { taskOrchestrator } from '../tasks/TaskOrchestrator.js';
import type { SnapshotHandle } from '../utils/toolContract/Tool.js';

let dispose: (() => void) | null = null;

/**
 * 注册两个提供者；重复调用幂等。返回注销函数（测试隔离用）。
 */
export function installOrchestrationSnapshotProviders(): () => void {
  if (dispose) return dispose;

  const unregisterCouncil = registerScopedSnapshotProvider({
    kind: 'council-engine',
    freezeSession: (sessionId) =>
      getCouncilEngine().freezeForSuspend({ sessionId }),
    restoreSession: (_sessionId, handle) =>
      getCouncilEngine().resumeFromSnapshot(handle as SnapshotHandle),
  });

  const unregisterTasks = registerScopedSnapshotProvider({
    kind: 'task-orchestrator',
    freezeSession: (sessionId) =>
      taskOrchestrator.freezeForSuspend({ sessionId }),
    restoreSession: (_sessionId, handle) =>
      taskOrchestrator.resumeFromSnapshot(handle as SnapshotHandle),
  });

  dispose = () => {
    unregisterCouncil();
    unregisterTasks();
    dispose = null;
  };
  return dispose;
}
