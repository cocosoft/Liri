/**
 * 2026-10-01 B14b（甲′）—— 模型上下文窗口的 **infra 级缓存**。
 *
 * 存在理由：`session -> context`（B14，1 条）的守卫者 `ContextWindowResolver` 原**静态**导入
 * app 层 `@modules/ai` 的 `ModelRegistry`（仅 1 处，同步路径）⇒ 该文件既不能下沉 infra
 * （会引入 `infra -> ai`），也不能被低层端口免费代理（净差恒为 0，见 layer-inversion
 * spec 的 B14b 立项单四次否决记录）。
 *
 * 解法：把"窗口取数"降为 **infra 级缓存**，由 app 侧（`ModelRegistry`，装载/刷新模型时）
 * **同步推入**：
 *   ai (app)        --static-->  utils/ModelWindowCache (infra)   ← app -> infra 合法
 *   context (app)   --static-->  utils/ModelWindowCache (infra)   ← 同层
 *   session (svc)   --static-->  utils/...                        ← service -> infra 合法
 * 因推入发生在 ModelRegistry 变更内存映射的**同一时刻**（非异步预热），故与今日
 * "同步读 ModelRegistry 内存缓存"**语义等价、零竞态**。
 *
 * 本模块零依赖（纯 Map），不含任何模型名/供应商名硬编码。
 */
const modelWindows = new Map<string, number>();

/** 写入/覆盖某模型的上下文窗口（tokens）。非正数忽略，避免污染缓存。 */
export function setModelWindow(model: string, tokens: number): void {
  if (!model || !(tokens > 0)) return;
  modelWindows.set(model, tokens);
}

/** 读取某模型的上下文窗口；未命中返回 undefined（由调用方走既有回落链）。 */
export function getModelWindow(model: string): number | undefined {
  return modelWindows.get(model);
}

/** 清空缓存（供测试与重建场景使用）。 */
export function clearModelWindows(): void {
  modelWindows.clear();
}
