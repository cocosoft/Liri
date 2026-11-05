/**
 * P37（2026-11-06）：`InboxManager` 对 `createSessionGateway()` 的注入端口。
 *
 * **为什么需要**：`createSessionGateway` 的静态闭包是
 * `SessionGateway → recovery/CrashRecoveryManager → @modules/infrastructure`（桶）
 * → `LocalHTTPService` → 全路由 → React context。包内直连会把整条 HTTP/UI 链拉进
 * `packages/service` 的类型/运行面（实测包程序 1317 → 3584 文件）。
 *
 * **注入方式**：实现由 entry 层在启动期推送注册
 * （`app/src/entrypoints/spiWiring.ts#registerAllSpis`）。
 * 未注册（例如直连 `InboxManager` 的纯单元测试）时返回 `undefined`，
 * 调用方按「无网关」降级：卡片回填 / 注入只留日志，不影响 Inbox 主流程。
 */
import type { UnifiedMessage } from '@modules/session/types/UnifiedMessage.js';

export interface RuntimeSessionGateway {
  getMessages(sessionId: string): Promise<UnifiedMessage[]>;
  updateMessage(
    sessionId: string,
    messageId: string,
    message: UnifiedMessage
  ): Promise<void>;
}

type RuntimeSessionGatewayFactory = () => RuntimeSessionGateway;

let factory: RuntimeSessionGatewayFactory | undefined;

/** 组合根注册（app 启动期一次性调用；传 `undefined` 可清除，供测试） */
export function registerRuntimeSessionGatewayFactory(
  next: RuntimeSessionGatewayFactory | undefined
): void {
  factory = next;
}

/** 取会话网关；未注册 ⇒ `undefined`（消费方必须自行降级） */
export function getRuntimeSessionGateway(): RuntimeSessionGateway | undefined {
  return factory?.();
}
