/**
 * 会话级工具作用域回收 —— **推送注入端口**（P1 拆包前置，2026-11-13）。
 *
 * **为什么需要**：`SessionPruner` 过去以 `await import('../tool/ToolScopeManager.js')`
 * 动态取 app 层单例（`tool` 层归属 app）。session 并入 `packages/service` 后：
 * ① 该相对路径直接断链；② 即便改别名也会构成 `service → app` 的跨层倒挂（R8 判红）。
 *
 * **注入方式**（同 P37 `coreApiProvider`）：实现由 entry 层在启动期推送注册
 * （`app/src/entrypoints/spiWiring.ts#registerAllSpis`）。未注册 ⇒ 跳过回收
 * （剪枝主流程不受影响；回收失败本就只告警）。
 */

/** 只需要"回收某会话的会话级作用域"这一面（`ToolScopeManager` 可结构赋值） */
export interface ToolScopeDisposerPort {
  disposeSession(sessionId: string): Promise<void>;
}

let disposer: ToolScopeDisposerPort | undefined;

/** 组合根注册（app 启动期一次性调用；传 `undefined` 可清除，供测试） */
export function registerToolScopeDisposer(
  next: ToolScopeDisposerPort | undefined
): void {
  disposer = next;
}

/** 取端口；未注册 ⇒ `undefined`（调用方跳过回收） */
export function getToolScopeDisposer(): ToolScopeDisposerPort | undefined {
  return disposer;
}
