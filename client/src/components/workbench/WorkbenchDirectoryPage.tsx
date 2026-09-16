/**
 * 工作台页（路由 `/workbench`）—— 四组功能导航的独立页面
 *
 * 取代原侧栏"工作台折叠按钮 + 内联展开"的抽屉式交互（展开会挤占左侧导航、
 * 且其下方图标被截断），改为整页展示：分区标题 + 功能卡片网格，点击跳转对应路由。
 *
 * 数据来源：`config/workbenchGroups.ts`（与侧栏入口共用同一份定义，单一事实来源）。
 */

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { WORKBENCH_GROUPS } from "@/config/workbenchGroups";

export default function WorkbenchDirectoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <h1 className="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">
          {t("sidebar.workbench")}
        </h1>

        {WORKBENCH_GROUPS.map((group) => {
          const Icon = group.items[0]?.icon;
          return (
            <section key={group.id} className="mb-6">
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                {Icon && <Icon size={14} />}
                {t(group.labelKey)}
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {group.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.path)}
                      className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-3 text-gray-700 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-blue-500 dark:hover:bg-gray-700"
                    >
                      <ItemIcon size={20} />
                      <span className="w-full truncate text-center text-xs">
                        {t(item.labelKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
