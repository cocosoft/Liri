import { useChatStore } from "../../stores/chatStore";
import { useWorkStore } from "../../stores/workStore";
import { useSessionStore } from "../../stores/sessionStore";
import PlanDoToggle from "./PlanDoToggle";
import ChatMessageList from "../ChatArea/ChatMessageList";
import ChatInput from "../ChatArea/ChatInput";

interface WorkChatPanelProps {
  className?: string;
}

/**
 * 右侧 AI 对话面板
 * 复用 ChatMessageList + ChatInput，顶部集成 PlanDoToggle
 * 与 chatStore 共享全局状态，不含 SessionHistorySidebar
 */
export default function WorkChatPanel({ className }: WorkChatPanelProps) {
  const mode = useWorkStore((s) => s.mode);
  const setMode = useWorkStore((s) => s.setMode);
  const isSending = useChatStore((s) => s.isSending);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messages = useChatStore((s) => s.messages);
  const currentSession = useSessionStore((s) => s.currentSession);

  return (
    <div
      className={`${className} flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700`}
    >
      {/* 顶部：Plan/Do 模式切换标签 */}
      <PlanDoToggle
        mode={mode}
        onToggle={setMode}
        disabled={isSending || isStreaming}
      />

      {/* 消息列表 */}
      <div className="flex-1 min-h-0 overflow-auto">
        <ChatMessageList
          messages={messages}
          isStreaming={isStreaming}
          hasSession={!!currentSession}
          sessionTitle={currentSession?.title}
        />
      </div>

      {/* 底部输入区 */}
      <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <ChatInput />
      </div>
    </div>
  );
}
