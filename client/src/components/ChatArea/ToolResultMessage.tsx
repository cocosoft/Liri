import { useTranslation } from "react-i18next";
import type { Message } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import { useChatStore } from "../../stores/chat";
import { decodeToolResultContent } from "../../utils/toolResultText";

interface ToolResultMessageProps {
  message: Message;
}

/** 安全拦截原因 → i18n 键映射 */
const SECURITY_REASON_KEYS: Record<string, string> = {
  path_safety: "chat.securityReasonPathSafety",
  dangerous_command: "chat.securityReasonDangerousCommand",
  dangerous_pattern: "chat.securityReasonDangerousPattern",
  ast_analysis: "chat.securityReasonAstAnalysis",
  security_analyzer_deny: "chat.securityReasonAnalyzerDeny",
  security_analyzer_ask: "chat.securityReasonAnalyzerAsk",
  command_whitelist: "chat.securityReasonCommandWhitelist",
  sandbox_checker: "chat.securityReasonSandboxChecker",
};

/**
 * 工具结果消息组件
 * 解析并显示工具执行的结果
 */
function ToolResultMessage({ message }: ToolResultMessageProps) {
  const { t } = useTranslation();
  // P0-5：精准 selector（避免整个 store 订阅）
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);

  // 检查是否为安全拦截结果
  const isSecurityIntercepted = message.metadata?.securityIntercepted === true;
  const securityReason = (message.metadata?.reason as string) || "";

  // 直接使用 message.content 作为工具结果值
  // message.toolCallId 从后端获取工具调用 ID
  const result = {
    type: "tool_result",
    value: message.content || "",
    toolCallId: message.toolCallId,
  };

  // 尝试解析 value 中的 JSON，格式化显示
  const formatValue = (value: string): string =>
    // 2026-09-27（P0-2/X3）：解信封 + 迭代解码嵌套 JSON + pretty-print；
    // 单一实现见 `utils/toolResultText.ts`（渲染与导出共用，CS01 不重复实现）。
    // 空信封（无 value）⇒ 兜底为 "—"，避免渲染空卡片。
    decodeToolResultContent(value).trim() || "—";

  return (
    <div className="text-sm break-words max-w-none">
      {/* 安全拦截横幅 */}
      {isSecurityIntercepted && (
        <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
          <span className="text-base shrink-0 mt-0.5">&#x26A0;&#xFE0F;</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-orange-700 dark:text-orange-400">
              {t("chat.securityIntercepted", "安全拦截")}
            </div>
            <div className="text-xs text-orange-600 dark:text-orange-500 mt-0.5">
              {SECURITY_REASON_KEYS[securityReason]
                ? t(SECURITY_REASON_KEYS[securityReason])
                : securityReason || t("chat.securityPolicyBlocked", "安全策略拦截")}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 rounded-full dark:bg-emerald-900/30 dark:text-emerald-400">
          {t("chat.toolReturn", "工具返回")}
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
