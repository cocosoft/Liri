import { useEffect } from "react";
import SessionHistorySidebar from "../ChatArea/SessionHistorySidebar";
import SessionHeader from "../ChatArea/SessionHeader";
import ChatArea from "../ChatArea/ChatArea";
import { ChatInspector } from "../ChatInspector";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { useRootStore } from "@/stores/root-store";

/**
 * 聊天页面布局：左侧会话历史 + 中间聊天区 + 右侧 ChatInspector
 *
 * 进入 /chat 页时通过 enterModule 设置 moduleType="chat"，
 * 替代 switchWorkspace，消除与 loadChatSessions 的 isLoading 冲突。
 */
export default function ChatPageLayout() {
  const enterModule = useRootStore((s) => s.enterModule);
  const leaveModule = useRootStore((s) => s.leaveModule);

  useEffect(() => {
    enterModule({ moduleType: "chat" });
    return () => leaveModule();
  }, [enterModule, leaveModule]);

  return (
    <div className="flex flex-1 page-transition-enter overflow-hidden">
      <SessionHistorySidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-gray-50 dark:bg-gray-900">
        <SessionHeader />
        <ErrorBoundary>
          <ChatArea />
        </ErrorBoundary>
      </main>
      <ErrorBoundary fallback={null}>
        <ChatInspector />
      </ErrorBoundary>
    </div>
  );
}
