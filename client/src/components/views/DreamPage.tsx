/**
 * @deprecated 2026-11-25（`.trae/specs/dream-buddy-wiring.md` P1-3）：路由 `/dream` 已收敛为
 * 重定向到 `/liri`（梦境日志 = Liri 的「梦境日志」页签）⇒ 本页**已无消费者**。
 * 按 `code-deletion.md` CD05 先摘入口、标记观察，暂不删除；观察期后仍无消费者再删。
 */
import { useTranslation } from "react-i18next";
import DreamLogTab from "../Buddy/DreamLogTab";

function DreamPage() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          {t("dream.title")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t("dream.desc")}
        </p>
        <DreamLogTab />
      </div>
    </div>
  );
}

export default DreamPage;
