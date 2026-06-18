import SessionHistorySidebar from "../ChatArea/SessionHistorySidebar";
import SessionHeader from "../ChatArea/SessionHeader";
import ChatArea from "../ChatArea/ChatArea";
import StatusFloatBar from "../ChatArea/StatusFloatBar";
import ChatInput from "../ChatArea/ChatInput";

/** 聊天页面布局：从 App.tsx 内联 JSX 提取 */
export default function ChatPageLayout() {
  return (
    <div className="flex flex-1 page-transition-enter overflow-hidden">
      <SessionHistorySidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <SessionHeader />
        <ChatArea />
        <StatusFloatBar />
        <ChatInput />
      </main>
    </div>
  );
}