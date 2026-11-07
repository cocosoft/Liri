/**
 * P37（2026-11-06）：`runtime` 包内对 **app 组合根**（`CoreAPIImpl`）的注入端口。
 *
 * **为什么需要**：`inboxApproval` / `approvalAuditSink` 过去用
 * `await import('@modules/runtime/api/CoreAPIImpl.js')` 惰性取 `getCoreAPI()`。
 * 迁包后这条边会让 `packages/service` 的类型面反向拉入整个 app 图
 * （实测：`CoreAPIImpl → domainSnapshotOps` 等 117 个 app 模块，包程序 1317 → 3584 文件）。
 *
 * **注入方式**：实现由 entry 层在启动期推送注册
 * （`app/src/entrypoints/spiWiring.ts#registerAllSpis`，同 D-128 的推送模型）。
 * 未注册时返回 `undefined`，消费方按「组合根不可用」降级（只留日志，不抛错）。
 */

/** 会话的最小结构（组合根侧的真实类型 `UnifiedSession` 可结构赋值过来） */
export interface RuntimeSessionLike {
  metadata?: object;
}

/** 会话网关的最小结构（`SessionGateway` 可结构赋值） */
export interface RuntimeSessionGatewayPort {
  getSession(id: string): Promise<RuntimeSessionLike | null | undefined>;
  updateSession(session: RuntimeSessionLike): Promise<void>;
}

/** PDCA 编排器的最小结构（恢复链只用 `resumeAfterApproval` / 拒绝时 `abort`） */
export interface RuntimePdcaOrchestratorPort {
  resumeAfterApproval(sessionId: string): Promise<{ phase: string }>;
  /** 2026-11-07：Inbox 拒绝 ⇒ 终止任务（否则永久挂起并锁死会话幂等键） */
  abort?(): Promise<void>;
}

/** 任务端口的最小结构 */
export interface RuntimeTaskOpsPort {
  getOrCreatePdcaOrchestrator(
    taskId: string
  ): Promise<RuntimePdcaOrchestratorPort | null | undefined>;
}

/** `CoreAPIImpl.chatManager` 的最小结构（审批续跑 / 工作区根追加 / 审计落盘） */
export interface RuntimeChatManagerPort {
  loadSession?(id: string): Promise<RuntimeSessionLike | undefined>;
  saveSession?(session: RuntimeSessionLike): Promise<void>;
  persistSessionMetadata?(session: RuntimeSessionLike): Promise<void>;
  getSessionGateway?(): RuntimeSessionGatewayPort | undefined;
  isSessionStreaming?(sessionId: string): boolean;
  resumeStream?(sessionId: string, checkpointId: string): AsyncIterable<unknown>;
  appendStreamEvent?(
    sessionId: string,
    event: unknown
  ): Promise<{ ok?: boolean; reason?: string } | undefined>;
}

export interface RuntimeCoreApiPort {
  chatManager?: RuntimeChatManagerPort;
  getTaskOpsPort?(): Promise<RuntimeTaskOpsPort>;
}

type RuntimeCoreApiProvider = () => RuntimeCoreApiPort | undefined;

let provider: RuntimeCoreApiProvider | undefined;

/** 组合根注册（app 启动期一次性调用；传 `undefined` 可清除，供测试） */
export function registerRuntimeCoreApiProvider(
  next: RuntimeCoreApiProvider | undefined
): void {
  provider = next;
}

/** 取组合根端口；未注册 ⇒ `undefined`（消费方必须自行降级） */
export function getRuntimeCoreApi(): RuntimeCoreApiPort | undefined {
  return provider?.();
}
