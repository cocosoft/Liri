import type { Message } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chatStore";

interface ToolResultMessageProps {
  message: Message;
}

/**
 * 工具结果消息组件
 * 解析并显示工具执行的结果
 */
function ToolResultMessage({ message }: ToolResultMessageProps) {
  const { readFileToPreview } = useChatStore();

  // 直接使用 message.content 作为工具结果值
  // message.toolCallId 从后端获取工具调用 ID
  const result = {
    type: "tool_result",
    value: message.content || "",
    toolCallId: message.toolCallId,
  };

  // 尝试解析 value 中的 JSON，格式化显示
  const formatValue = (value: string): string => {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  };

  return (
    <div className="text-sm break-words max-w-none">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 rounded-full dark:bg-emerald-900/30 dark:text-emerald-400">
          工具返回
        </span>
        {result.toolCallId && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            #{result.toolCallId.slice(-8)}
          </span>
        )}
      </div>
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
        <MarkdownRenderer
          content={formatValue(result.value)}
          onPreviewFile={readFileToPreview}
        />
      </div>
    </div>
  );
}

export default ToolResultMessage;
