/**
 * useMessageDispatcher — 统一消息发送协调层
 *
 * 职责：
 * 1. 确保 session 存在（不存在时自动创建）
 * 2. 发送前校验（空内容过滤）
 * 3. 发送前后状态切换协调
 * 4. 发送失败的统一错误提示
 *
 * 使用方式：
 *   const { dispatch, isDispatching } = useMessageDispatcher();
 *   await dispatch("用户输入的内容");
 */

import { useCallback, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSessionStore } from "../stores/sessionStore";
import { useTranslation } from "react-i18next";
import { createLogger } from "@/utils/logger";

const logger = createLogger("hooks:useMessageDispatcher");

interface MessageDispatcherResult {
  /** 发送消息，返回是否成功 */
  dispatch: (content: string) => Promise<boolean>;
  /** 是否正在发送中 */
  isDispatching: boolean;
}

export function useMessageDispatcher(): MessageDispatcherResult {
  const { t } = useTranslation();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const currentSession = useSessionStore((s) => s.currentSession);
  const createSession = useSessionStore((s) => s.createSession);

  const [isDispatching, setIsDispatching] = useState(false);

  const dispatch = useCallback(
    async (content: string): Promise<boolean> => {
      // 校验：空内容
      if (!content.trim()) return false;

      setIsDispatching(true);
      try {
        // 确保 session 存在
        let session = currentSession;
        if (!session) {
          session = await createSession(t("chat.newSession", "新会话"));
          if (!session) {
            return false;
          }
        }

        await sendMessage(session.id, content);
        return true;
      } catch (error) {
        logger.error("发送消息失败:", error);
        return false;
      } finally {
        setIsDispatching(false);
      }
    },
    [currentSession, createSession, sendMessage, t],
  );

  return { dispatch, isDispatching };
}
