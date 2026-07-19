/**
 * sendMessage use-case — 用户发送消息的完整编排流程
 *
 * 跨 Slice 编排：chatStore.sendMessage + SessionHub 元数据联动。
 * 返回控制对象，UI 可通过 cancel 调用 chatStore.stopMessage() 中断。
 *
 * 消息内容由 chatStore 管理，SessionSlice 负责会话元数据。
 */

import { useRootStore } from "../root-store";
import { useChatStore } from "../chat";
import { createLogger } from "@/utils/logger";

const logger = createLogger("usecase:sendMessage");

/** sendMessage 返回的控制对象 */
export interface SendMessageController {
  /** 消息发送完成的 Promise */
  promise: Promise<void>;
  /** 取消当前流式输出（委托给 chatStore.stopMessage） */
  cancel: () => void;
}

/**
 * 发送用户消息
 *
 * 委托给 chatStore.sendMessage（异步，等待完整回复）。
 * 返回控制对象，cancel() 调用 chatStore.stopMessage 中断流式输出。
 */
export function sendMessage(content: string, sessionId?: string): SendMessageController {
  const root = useRootStore.getState();
  const chat = useChatStore.getState();

  logger.info("开始发送消息", {
    sessionId: sessionId ?? root.currentSessionId,
    msgLength: content.length,
  });

  // 消息实际内容由 chatStore 管理，SessionSlice 负责元数据
  // updatedAt 由 Slice 内部在上下文变更时自动维护

  // chatStore.sendMessage 是异步的，等待完整回复
  const promise = chat.sendMessage(content, sessionId)
    .then(() => {
      logger.info("消息发送完成", { sessionId: root.currentSessionId });
    })
    .catch((err: unknown) => {
      logger.error("消息发送失败", { error: String(err) });
    });

  return {
    promise,
    cancel: () => chat.stopMessage(),
  };
}
