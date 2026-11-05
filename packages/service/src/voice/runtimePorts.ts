/**
 * voice 包的上层端口（P33，2026-11-05）
 *
 * 迁包前 `voice` 有两处**运行期** app 依赖：
 *   ① `VoiceSession` → `getCoreAPI().getToolManager()`（app 的 `runtime` 门面）；
 *   ② `VoiceServiceBridge` → `SessionManager.instance`（app 的 `session` 桶）。
 * 二者都是「实现层单例」。`voice` 迁入 `packages/service` 后包内不得再引 `app/src`
 * ⇒ 与 P30（`setPromptCoreApiProvider`）/ P32（`setMcpToolScopePortLoader`）同口径反转依赖：
 * 包内只留端口，实现在启动期由 `bootstrap/preflight.ts` 注入（`main.ts` 零增行）。
 *
 * 未注入时的语义（**不静默**）：
 *   - 工具端口缺失 ⇒ 会话不注册工具桥接，并记 error 日志（语音通话本身不受影响）；
 *   - 会话集成端口缺失 ⇒ 不做转写持久化与 token 回写 —— 与迁包前
 *     `if (SessionManager.instance)` 的跳过语义逐字一致。
 */

import type { Tool } from '@openliri/infra/utils/toolContract/Tool';
import type { UnifiedMessage } from '@modules/session/types/UnifiedMessage';

/**
 * 工具执行能力的最小契约（只声明 voice 真正消费的两处）。
 *
 * 类型取自 `@openliri/infra/utils/toolContract/Tool`（infra 已物理独立）⇒ 端口与
 * 实现方 `ToolManager` 的结构完全同源，不需要在包内复制形状。
 */
export interface VoiceToolManagerPort {
  executeTool(
    name: string,
    input: unknown,
    context: { sessionId: string }
  ): Promise<unknown>;
  getAllTools(): Tool[];
}

/** 会话 token 计量能力（voice 只在断开连接时回写一次用量） */
export interface VoiceSessionManagerPort {
  recordTokenConsumption(
    sessionId: string,
    tokens: number,
    period?: string
  ): void;
}

/** 转写持久化能力（voice 在 `transcript.user` / `transcript.done` 时落盘） */
export interface VoiceTranscriptManagerPort {
  recordMessage(sessionId: string, message: UnifiedMessage): Promise<void>;
}

/** 注入到每个新建 VoiceSession 的会话侧上下文 */
export interface VoiceSessionIntegrationPort {
  sessionManager?: VoiceSessionManagerPort;
  transcriptManager?: VoiceTranscriptManagerPort;
}

let toolManagerProvider: (() => VoiceToolManagerPort | null) | null = null;
let sessionIntegrationProvider:
  | (() => VoiceSessionIntegrationPort | null)
  | null = null;

/** 注入工具管理器来源（启动期调用一次；延迟取值，避免启动顺序耦合） */
export function setVoiceToolManagerProvider(
  provider: (() => VoiceToolManagerPort | null) | null
): void {
  toolManagerProvider = provider;
}

/** 注入会话侧上下文来源（启动期调用一次；延迟取值） */
export function setVoiceSessionIntegrationProvider(
  provider: (() => VoiceSessionIntegrationPort | null) | null
): void {
  sessionIntegrationProvider = provider;
}

/** 取工具管理器端口；未注入 ⇒ `null`（调用方必须如实记录，不得静默降级为“无工具”） */
export function resolveVoiceToolManager(): VoiceToolManagerPort | null {
  return toolManagerProvider?.() ?? null;
}

/** 取会话侧上下文端口；未注入 ⇒ `null` */
export function resolveVoiceSessionIntegration(): VoiceSessionIntegrationPort | null {
  return sessionIntegrationProvider?.() ?? null;
}
