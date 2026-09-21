/**
 * 工作台页（路由 `/workbench`）—— 四组功能导航的独立页面
 *
 * 取代原侧栏"工作台折叠按钮 + 内联展开"的抽屉式交互（展开会挤占左侧导航、
 * 且其下方图标被截断），改为整页展示：分区标题 + 功能卡片网格，点击跳转对应路由。
 *
 * 数据来源：`@/config/navRegistry`（§4.3-6：与侧栏/首页/移动端底栏共用同一份定义，单一事实来源）。
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/shallow";
import { useRootStore } from "@/stores/root-store";
import { selectEnabledModules } from "@/stores/selectors";
import { toEnabledModuleIds, workbenchGroups } from "@/config/navRegistry";
import { PreviewBadge } from "../common/PreviewBadge";

export default function WorkbenchDirectoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // §4.3-7：为当前页对应条目补 aria-current（与侧栏/底栏同一语义）
  const { pathname } = useLocation();
  // §4.3-6：组内条目需过模块门控（base 档隐藏 pro 模块），集合由 selectEnabledModules 派生
  const enabledModules = useRootStore(useShallow(selectEnabledModules));
  const groups = useMemo(
    () => workbenchGroups(toEnabledModuleIds(enabledModules)),
    [enabledModules],
  );

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <h1 className="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-100">
          {t("sidebar.workbench")}
        </h1>

        {groups.map((group) => {
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
                      aria-current={
                        item.path && pathname === item.path.split("?")[0]
                          ? "page"
                          : undefined
                      }
                      onClick={() => {
                        if (item.path) navigate(item.path);
                      }}
                      className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-3 text-gray-700 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-blue-500 dark:hover:bg-gray-700"
                    >
                      <ItemIcon size={20} />
                      <span className="w-full truncate text-center text-xs flex items-center justify-center gap-1">
                        {t(item.labelKey)}
                        {item.preview && <PreviewBadge />}
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
