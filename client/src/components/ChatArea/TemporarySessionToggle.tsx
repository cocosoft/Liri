import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/sessionStore";

/**
 * UI 期 UI-3（2026-09-23 修复计划 §十）：临时对话开关（A1）。
 *
 * 迁移自 `ChatArea` 内的独立一行（原实现独占输入框上方一整行，用户反馈"太挤了"）
 * ——逻辑与状态契约**逐字保留**，只是宿主从"独立行"改为 `ChatInput` 工具栏行内
 * （与模式选择器 / 上传 / emoji 同行）。
 *
 * - 状态源：`currentSession.metadata.temporary === true`（**持久化标记**，符合 CS02
 *   —— 禁止用标题字符串判断）；
 * - 切换动作：新建对应模式会话 + URL `?temporary=1` 同步（对齐 Copilot Temporary）；
 * - 全文说明走 `title`，行内只在开启时显示精简徽标（避免与同行工具按钮挤压）。
 */
function TemporarySessionToggle() {
  const { t } = useTranslation();
  const currentSession = useSessionStore((s) => s.currentSession);
  const createSession = useSessionStore((s) => s.createSession);
  const isTemporary = currentSession?.metadata?.temporary === true;

  const handleToggle = (next: boolean) => {
    if (next === isTemporary) return; // 已在目标模式，无需新建
    // 关闭时回到普通会话（标题用"新建会话"），开启时用"临时对话"
    const title = next ? t("chat.temporaryToggle") : t("chat.newSession");
    void createSession(title, { temporary: next })
      .then(() => {
        const url = new URL(window.location.href);
        if (next) url.searchParams.set("temporary", "1");
        else url.searchParams.delete("temporary");
        window.history.replaceState({}, "", url.pathname + url.search);
      })
      .catch(() => {
        // @ignore-catch — 创建失败已由 createChatSession toast，URL 保持原样避免状态不一致
      });
  };

  return (
    <button
      type="button"
      onClick={() => handleToggle(!isTemporary)}
      className={`ml-auto flex items-center gap-1.5 text-xs font-medium rounded-lg px-2 py-0.5 transition-colors ${
        isTemporary
          ? "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
      aria-pressed={isTemporary}
      title={t("chat.temporaryHint")}
    >
      <span>
        {isTemporary ? t("chat.temporaryBadge") : t("chat.temporaryToggle")}
      </span>
      <span
        className={`relative inline-flex w-7 h-4 rounded-full transition-colors ${
          isTemporary ? "bg-amber-500" : "bg-gray-300 dark:bg-gray-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
            isTemporary ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export default TemporarySessionToggle;
