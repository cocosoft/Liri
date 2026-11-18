/**
 * channels 对「app 组合根（CoreAPI）」的**推送注入端口**（拆包前置 P0，2026-11-13）。
 *
 * **为什么需要**：`setupChannels.ts` 过去直接
 * `import { getCoreAPI } from '../runtime/api/CoreAPIImpl'`。channels 迁入
 * `packages/channels` 后，这条**值导入**会反向把整个 app 图拉进包
 * （同 P37 在 `packages/service/src/runtime/api/coreApiProvider.ts` 的实测：
 * 包程序 1317 → 3584 文件）。
 *
 * **注入方式**：实现由 entry 层在启动期推送注册
 * （`app/src/entrypoints/spiWiring.ts#registerAllSpis`，同 D-128 推送模型）。
 * 未注册时 `getChannelCoreApi()` 返回 `undefined`，消费方按「组合根不可用」
 * 降级（只留日志，不抛错）。
 */

import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI';
import type { RequestPriority } from '@modules/types/requestPriority';

/**
 * 渠道入站所需的最小 CoreAPI 面（`CoreAPIImpl` 可结构赋值）。
 * 形状与 `RouteMessageOptions.coreAPI` 同源 —— 后者直接引用本类型。
 */
export interface ChannelCoreApiPort {
  chat(params: {
    content: string;
    sessionId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ content: string; finishReason?: string }>;
  /**
   * U-05b（2026-10-17）：提交流程中的交互提问回答。
   * 缺省（旧 mock）⇒ 待答消费按失败处理，不影响普通消息路径。
   */
  resolveInteraction?(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): Promise<boolean>;
  /** 流式并轨（2026-08-20）：渠道消息主路径，与 client /v1/chat/stream 同管线 */
  chatStream(params: {
    content: string;
    sessionId: string;
    /**
     * U-07（2026-10-17）：入站消息 id（写前落盘复用/重投幂等）。
     * 缺省时后端自行生成；渠道侧应传 `MessageContext.messageId`。
     */
    messageId?: string;
    /** P26-1 §9.1（2026-10-07）：请求优先级（渠道入站传 `background`） */
    priority?: RequestPriority;
    /** PR1（2026-10-09）：执行标识（Execution 生命周期归属；见 spec） */
    executionId?: string;
    /** PR2（2026-10-09）：外部取消信号（端到端贯通 Router → CoreAPI → ChatManager） */
    signal?: AbortSignal;
    /**
     * 运行时补充系统提示（2026-10-17）：渠道入站注入**投递契约**（附件由通道侧自动投递，
     * 模型不得臆断发送状态）。按请求追加、不进会话历史。
     */
    runtimeSystemNote?: string;
    /**
     * T1-6（通道治理 §1.3 收口，2026-10-13）：**入站附件的字节口径**（供 R16 日预算预留）。
     *
     * **仅取 `size`**（与 `query/attachmentBudget.estimateAttachmentsTokens` 的结构化入参同形）；
     * **不**复用 `images`（后者是多模态载体，消费方读 `img.path`，见 `StreamPipeline.ts`）⇒
     * 避免把通道附件污染为模型图片输入。⚠️ 通道协议层 `MessageAttachment` 与会话领域层
     * **同名不同物**（`enums.ts:142-145`）⇒ 跨层只做**显式适配**（不互换类型）。
     */
    attachmentSizes?: readonly { size?: number }[];
    metadata?: Record<string, unknown>;
  }): AsyncGenerator<
    ChatStreamChunk,
    { content: string; finishReason?: string; sessionId?: string },
    unknown
  >;
}

type ChannelCoreApiProvider = () => ChannelCoreApiPort | undefined;

let provider: ChannelCoreApiProvider | undefined;

/** 组合根注册（app 启动期一次性调用；传 `undefined` 可清除，供测试） */
export function registerChannelCoreApiProvider(
  next: ChannelCoreApiProvider | undefined
): void {
  provider = next;
}

/** 取组合根端口；未注册 ⇒ `undefined`（消费方必须自行降级） */
export function getChannelCoreApi(): ChannelCoreApiPort | undefined {
  return provider?.();
}
