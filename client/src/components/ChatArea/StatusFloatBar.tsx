import { useChatStore } from "../../stores/chatStore";

/**
 * 运行状态浮动面板
 *
 * 浮于 ChatArea 消息列表与 ChatInput 输入区之间，展示当前会话的运行状态。
 * - 运行中：绿色脉冲点 + 状态描述文本
 * - 空闲：不渲染
 */
export default function StatusFloatBar() {
  const isSending = useChatStore((s) => s.isSending);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isUploading = useChatStore((s) => s.isUploading);
  const streamingStatus = useChatStore((s) => s.streamingStatus);

  const isActive = isSending || isStreaming || isUploading;

  if (!isActive) return null;

  /**
   * 根据当前状态生成显示文本
   */
  const getStatusText = (): string => {
    if (isUploading) return "正在上传文件...";
    if (isSending && !isStreaming) return "正在发送...";
    if (streamingStatus) return streamingStatus;
    return "AI 正在回复...";
  };

  return (
    <div className="px-4 pb-0">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
          {/* 状态指示点：绿色脉冲 = 运行中 */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>

          {/* 状态文本 */}
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {getStatusText()}
          </span>
        </div>
      </div>
    </div>
  );
}
