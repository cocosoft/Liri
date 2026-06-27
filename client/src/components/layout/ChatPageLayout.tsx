import { useConfigStore } from "../../stores/configStore";
import { useAppStore } from "../../stores/appStore";
import SessionHistorySidebar from "../ChatArea/SessionHistorySidebar";
import SessionHeader from "../ChatArea/SessionHeader";
import ChatArea from "../ChatArea/ChatArea";
import StatusFloatBar from "../ChatArea/StatusFloatBar";
import ChatInput from "../ChatArea/ChatInput";
import VoiceSubtitleOverlay from "../VoiceSubtitleOverlay";

/** 聊天页面布局：从 App.tsx 内联 JSX 提取 */
export default function ChatPageLayout() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";
  const interimText = useAppStore((s) => s.interimText);
  const finalText = useAppStore((s) => s.finalText);
  const audioLevel = useAppStore((s) => s.audioLevel);
  const subtitleStatus = useAppStore((s) => s.subtitleStatus);

  return (
    <div className="flex flex-1 page-transition-enter overflow-hidden">
      <SessionHistorySidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <SessionHeader />
        <ChatArea />
        <StatusFloatBar />
        <div className="relative">
          <VoiceSubtitleOverlay
            interimText={interimText}
            finalText={finalText}
            audioLevel={audioLevel}
            status={subtitleStatus}
            isDark={isDark}
            position="bottom"
          />
          <ChatInput />
        </div>
      </main>
    </div>
  );
}