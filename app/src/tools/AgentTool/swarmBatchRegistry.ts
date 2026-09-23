/**
 * 并行批次取消注册表（R1 修正，2026-09-22）
 *
 * **为什么必须是进程内单例**（而不是 `AgentTool` 的实例字段）：
 * `AgentTool` 有**多个构造点**（ToolManager loader / `Coordinator` / `getAllBaseTools()`）；
 * `_ledger` 正因此在前一轮从实例字段升级为模块级单例 —— 其注释写明"实例字段会让
 * '能否再开一个'只按单实例计数"，与 `SubAgentEngine` / `AgentRunStore` 的单例口径分裂。
 *
 * 批次取消注册表若留在实例上，会出现：**注册控制器的是执行批次的实例，而控制面
 * `/v1/agents/:id/stop` 取到的是另一个 `AgentTool` 实例** ⇒ `stopAgent` 查不到该 batchId
 * 的控制器 ⇒ "批次级取消"静默失效（在飞 worker 被中止、未投递批次照常启动）。
 * 故与 `getAgentRunLedger()` 同法：模块级单例 + 测试用 `reset`。
 */

/** batchId → 该批次的 AbortController */
const batchAborts = new Map<string, AbortController>();

/** 登记批次控制器（`runSwarmPath` 开工前调用） */
export function registerBatchAbort(
  batchId: string,
  controller: AbortController
): void {
  batchAborts.set(batchId, controller);
}

/** 取批次控制器（`stopAgent` 的批次级取消入口） */
export function getBatchAbort(batchId: string): AbortController | undefined {
  return batchAborts.get(batchId);
}

/** 注销批次控制器（`runSwarmPath` 的 `finally` 调用，防泄漏） */
export function unregisterBatchAbort(batchId: string): void {
  batchAborts.delete(batchId);
}

/** 当前登记的批次数（巡检/测试用） */
export function swarmBatchRegistrySize(): number {
  return batchAborts.size;
}

/** 仅测试使用：清空注册表，避免用例间状态串味（生产路径不得调用） */
export function resetSwarmBatchRegistry(): void {
  batchAborts.clear();
}
