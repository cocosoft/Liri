/**
 * bridge 的上层端口（P35，2026-11-05）
 *
 * 迁包前 `BridgeMain` 直接 `getCoreAPI().getBridgePort()`（app 的 `runtime` 门面）。
 * `bridge` 已在 `packages/service` 内，但 `runtime` 仍留在 `app/src` ⇒ 该静态值导入会把
 * `app` 的整张类型图拉进包程序（实测包 typecheck 从 253 文件涨到 3559）。
 *
 * 与 P30（`setPromptCoreApiProvider`）/ P32（`setMcpToolScopePortLoader`）同口径反转：
 * 包内只留端口，实现由 `bootstrap/preflight.ts` 注入。
 *
 * 未注入 ⇒ 抛出明确错误（worktree 隔离是 bridge 的核心能力，静默降级会让"会话隔离"无声失效）。
 */

import type { BridgePort } from '@openliri/service/ports/bridgePorts';

let provider: (() => Promise<BridgePort>) | null = null;

/** 注入 Bridge 运行时端口来源（启动期调用一次；延迟取值） */
export function setBridgePortProvider(
  fn: (() => Promise<BridgePort>) | null
): void {
  provider = fn;
}

/** 取 Bridge 运行时端口；未注入 ⇒ 抛错（fail-visible，不静默降级） */
export async function resolveBridgePort(): Promise<BridgePort> {
  if (!provider) {
    throw new Error(
      'bridge: BridgePort 端口未注入（应由 bootstrap/preflight.wireServiceDeps 接线）'
    );
  }
  return provider();
}
