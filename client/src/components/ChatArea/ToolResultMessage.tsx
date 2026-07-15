import type { Message } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chatStore";

interface ToolResultMessageProps {
  message: Message;
}

/** 安全拦截原因的中文映射 */
const SECURITY_REASON_LABELS: Record<string, string> = {
  path_safety: "路径安全检查",
  dangerous_command: "危险命令检测",
  dangerous_pattern: "危险命令模式",
  ast_analysis: "AST安全分析",
  security_analyzer_deny: "安全策略拒绝",
  security_analyzer_ask: "需用户确认",
  command_whitelist: "命令白名单",
  sandbox_checker: "沙箱安全检查",
};

/**
 * 工具结果消息组件
 * 解析并显示工具执行的结果
 */
function ToolResultMessage({ message }: ToolResultMessageProps) {
  const { readFileToPreview } = useChatStore();

  // 检查是否为安全拦截结果
  const isSecurityIntercepted =
    message.metadata?.securityIntercepted === true;
  const securityReason =
    (message.metadata?.reason as string) || "";

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
      {/* 安全拦截横幅 */}
      {isSecurityIntercepted && (
        <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
          <span className="text-base shrink-0 mt-0.5">&#x26A0;&#xFE0F;</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-orange-700 dark:text-orange-400">
              安全拦截
            </div>
            <div className="text-xs text-orange-600 dark:text-orange-500 mt-0.5">
              {SECURITY_REASON_LABELS[securityReason] || securityReason || "安全策略拦截"}
            </div>
          </div>
        </div>
      )}

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
