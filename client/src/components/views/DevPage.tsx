import { lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DevIcon, SearchIcon, FileIcon, SettingsIcon, ThemeIcon, ChatIcon, MicIcon } from "../../assets/icons";

/** 开发者工具导航项 */
interface DevNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

/** 懒加载子页面注册表 */
const SUB_PAGE_REGISTRY: Record<string, React.LazyExoticComponent<React.FC>> = {
  terminal: lazy(() => import("./TerminalPage")),
  logs: lazy(() => import("./LogViewerPage")),
  files: lazy(() => import("./FileExplorerPage")),
  sandbox: lazy(() => import("./SandboxPage")),
  media: lazy(() => import("./MediaPage")),
  autoreply: lazy(() => import("./AutoReplyPage")),
  "stt-test": lazy(() => import("./STTTestPage")),
};

const NAV_ITEMS: DevNavItem[] = [
  { id: "terminal", label: "终端", icon: DevIcon },
  { id: "logs", label: "日志", icon: SearchIcon },
  { id: "files", label: "文件管理", icon: FileIcon },
  { id: "sandbox", label: "沙箱", icon: SettingsIcon },
  { id: "media", label: "媒体管理", icon: ThemeIcon },
  { id: "autoreply", label: "自动回复", icon: ChatIcon },
  { id: "stt-test", label: "语音测试", icon: MicIcon },
];

/** 导航项 id 到 i18n key 的映射 */
const NAV_LABEL_KEYS: Record<string, string> = {
  terminal: "dev.terminal",
  logs: "dev.logs",
  files: "dev.fileManager",
  sandbox: "dev.sandbox",
  media: "dev.media",
  autoreply: "dev.autoReply",
  "stt-test": "dev.voiceTest",
};

/** 子页面标识到路径的映射 */
const SUB_ROUTE_MAP: Record<string, string> = {
  terminal: "/dev/terminal",
  logs: "/dev/logs",
  files: "/dev/files",
  sandbox: "/dev/sandbox",
  media: "/dev/media",
  autoreply: "/dev/autoreply",
  "stt-test": "/dev/stt-test",
};

function DevPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subPage } = useParams<{ subPage?: string }>();
  const activeNav = subPage && NAV_ITEMS.some((n) => n.id === subPage) ? subPage : "terminal";

  return (
    <div className="flex flex-1 min-w-0 h-full bg-gray-50 dark:bg-gray-900">
      {/* ── 左侧导航 ── */}
      <aside className="w-48 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="px-4 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t("dev.title")}
          </h2>
        </div>
        <nav className="pb-6">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            const IconComponent = item.icon;
            return (
              <button
                  key={item.id}
                  onClick={() => navigate(SUB_ROUTE_MAP[item.id] || "/dev/terminal")}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium border-r-2 border-blue-500"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <IconComponent size={18} />
                <span className="truncate">{t(NAV_LABEL_KEYS[item.id] || item.label)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-white dark:bg-gray-800">
        <Suspense fallback={<div className="p-6 text-gray-500 dark:text-gray-400">{t("common.loading")}</div>}>
          {renderActivePage()}
        </Suspense>
      </main>
    </div>
  );

  /** 渲染当前激活的子页面 */
  function renderActivePage() {
    const LazyComp = SUB_PAGE_REGISTRY[activeNav];
    if (!LazyComp) return <div className="p-6 text-gray-500 dark:text-gray-400">{t("dev.pageNotFound")}</div>;
    return <LazyComp />;
  }
}

export default DevPage;
