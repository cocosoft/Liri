import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchSoul, saveSoul } from "../../services/soulService";
import { ConfigSection } from "./ConfigComponents";
import { handleClientError } from "../../utils/handleError";

interface SoulPanelProps {
  isDark: boolean;
}

const DEFAULT_SOUL = `# SOUL.md — Liri 的人格

## 核心信念

- 你是 Liri，一个有主见的 AI 私人助手
- 你有自己的观点——可以不同意、有偏好、觉得有趣或无聊
- 先尝试再问——自己读文件、查上下文、搜资料
- 凭能力赢得信任——外部操作小心，内部操作大胆
- 记住你是客人——用户给了系统访问权限，尊重隐私

## 边界

- 用户的数据就是用户的数据。结果说清楚，但数据留在用户本地
- 涉及外部操作（发消息、发邮件、网络请求）时，先征求确认
- 不要未经用户同意修改用户的个人文件

## 语气

简洁、准确、友好。
- 日常对话：轻松但专业
- 代码任务：直接，用代码说话
- 分析任务：结构化，有证据
- 出错时：诚实，不推诿，给解决方案
`;

/**
 * 玲珑鸟人格设置面板
 *
 * 允许用户查看和编辑 SOUL.md 中定义的 AI 人格（核心信念、边界、语气）
 */
function SoulPanel({ isDark }: SoulPanelProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    loadSoul();
  }, []);

  /** 加载当前人格定义 */
  const loadSoul = async () => {
    try {
      const data = await fetchSoul();
      setContent(data);
      setOriginalContent(data);
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:Soul",
        action: "loadSoul",
      });
      setMessage({ type: "error", text: "加载人格定义失败" });
    }
  };

  /** 保存人格定义 */
  const handleSave = async () => {
    if (!content.trim()) {
      setMessage({ type: "error", text: "内容不能为空" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveSoul(content);
      setOriginalContent(content);
      setMessage({ type: "success", text: "人格定义已保存" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      handleClientError(e, {
        module: "components:settings:Soul",
        action: "handleSave",
      });
      setMessage({ type: "error", text: "保存失败，请重试" });
    } finally {
      setSaving(false);
    }
  };

  /** 恢复默认人格 */
  const handleReset = () => {
    setContent(DEFAULT_SOUL);
  };

  const hasChanges = content !== originalContent;

  return (
    <ConfigSection
      title={t("settings.soul")}
      description={t("settings.soulDesc")}
      isDark={isDark}
    >
      <div className="space-y-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={`w-full h-80 px-4 py-3 text-sm font-mono border rounded ${
            isDark
              ? "bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-500"
              : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400"
          }`}
          placeholder={t("settings.soulDesc")}
        />

        {message && (
          <p
            className={`text-sm ${
              message.type === "success"
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
              saving || !hasChanges
                ? "bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                : "bg-blue-500 text-white hover:bg-blue-600"
            }`}
          >
            {saving ? "保存中..." : t("common.save")}
          </button>

          <button
            onClick={handleReset}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
              isDark
                ? "bg-gray-700 text-gray-200 hover:bg-gray-600"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            恢复默认
          </button>
        </div>
      </div>
    </ConfigSection>
  );
}

export default SoulPanel;
