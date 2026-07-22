import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchUser, saveUser } from "../../services/soulService";
import { ConfigSection } from "./ConfigComponents";
import { handleClientError } from "../../utils/handleError";

interface UserPanelProps {
  isDark: boolean;
}

const DEFAULT_USER = `# USER.md — 用户身份

## 基本信息

- 称呼：用户
- 专业领域：软件开发
- 技术栈偏好：TypeScript, Rust, Python
- 工作场景：编程开发

## 沟通偏好

- 回复语言：中文
- 详细程度：平衡
`;

/**
 * 用户身份设置面板
 *
 * 允许用户查看和编辑 USER.md 中定义的个人身份信息
 */
function UserPanel({ isDark }: UserPanelProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    loadUser();
  }, []);

  /** 加载当前用户身份 */
  const loadUser = async () => {
    try {
      const data = await fetchUser();
      setContent(data);
      setOriginalContent(data);
    } catch (e) {
      handleClientError(e, { module: "components:settings:User", action: "loadUser" });
      setMessage({ type: "error", text: "加载用户身份失败" });
    }
  };

  /** 保存用户身份 */
  const handleSave = async () => {
    if (!content.trim()) {
      setMessage({ type: "error", text: "内容不能为空" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveUser(content);
      setOriginalContent(content);
      setMessage({ type: "success", text: "用户身份已保存" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      handleClientError(e, { module: "components:settings:User", action: "handleSave" });
      setMessage({ type: "error", text: "保存失败，请重试" });
    } finally {
      setSaving(false);
    }
  };

  /** 恢复默认用户身份 */
  const handleReset = () => {
    setContent(DEFAULT_USER);
  };

  const hasChanges = content !== originalContent;

  return (
    <ConfigSection
      title={t("settings.userProfile")}
      description={t("settings.userProfileDesc")}
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
          placeholder="输入用户身份信息..."
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

export default UserPanel;
