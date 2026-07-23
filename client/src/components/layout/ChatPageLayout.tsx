import SessionHistorySidebar from "../ChatArea/SessionHistorySidebar";
import SessionHeader from "../ChatArea/SessionHeader";
import ChatArea from "../ChatArea/ChatArea";
import { ChatInspector } from "../ChatInspector";
import { ErrorBoundary } from "../common/ErrorBoundary";

/** 聊天页面布局：左侧会话历史 + 中间聊天区 + 右侧 ChatInspector */
export default function ChatPageLayout() {
  return (
    <div className="flex flex-1 page-transition-enter overflow-hidden">
      <SessionHistorySidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-gray-50 dark:bg-gray-900">
        <SessionHeader />
        <ChatArea />
      </main>
      <ErrorBoundary fallback={null}>
        <ChatInspector />
      </ErrorBoundary>
    </div>
  );
}
